"""Financial round-trip for disposable, networkless MariaDBs on hosted CI only."""

import hashlib
import os
import subprocess
import time
from pathlib import Path


class Database:
    def __init__(self, task):
        if (
            os.environ.get("GITHUB_ACTIONS") != "true"
            or os.environ.get("RUNNER_ENVIRONMENT") != "github-hosted"
        ):
            raise RuntimeError(
                "Database drill is restricted to a disposable GitHub-hosted runner"
            )
        self.tag = task
        self.cid = subprocess.check_output(
            [
                "docker",
                "run",
                "-d",
                "--label",
                "muledger.offsite.task=" + self.tag,
                "--network",
                "none",
                "--memory",
                "512m",
                "--cpus",
                "1",
                "--tmpfs",
                "/var/lib/mysql:rw,size=384m",
                "-e",
                "MARIADB_ALLOW_EMPTY_ROOT_PASSWORD=1",
                "-e",
                "MARIADB_DATABASE=trading_ledger",
                "mariadb:11",
                "--innodb-buffer-pool-size=64M",
                "--max-connections=12",
            ],
            text=True,
        ).strip()
        try:
            for _ in range(65):
                if (
                    subprocess.run(
                        self.cmd(
                            "mariadb", "-uroot", "trading_ledger", "-e", "SELECT 1"
                        ),
                        stdout=subprocess.DEVNULL,
                        stderr=subprocess.DEVNULL,
                    ).returncode
                    == 0
                ):
                    break
                time.sleep(1)
            else:
                raise RuntimeError("fixture database not ready")
        except BaseException:
            self.close()
            raise

    def cmd(self, *args):
        return ["docker", "exec", "-i", self.cid, *args]

    def sql(self, source):
        return (
            subprocess.check_output(
                self.cmd("mariadb", "-BN", "-uroot", "trading_ledger"),
                input=source.encode(),
            )
            .decode()
            .strip()
        )

    def prepare(self):
        for migration in sorted(Path("prisma/migrations").glob("*/migration.sql")):
            self.sql(migration.read_text())
        self.sql("""
INSERT INTO User(id,email,password,role,updatedAt) VALUES ('admin','fixture@example.invalid','not-a-login','ADMIN',NOW());
INSERT INTO Customer(id,mark,normalized_mark,order_name,name,phone,city,createdBy,ownerId,updatedAt) VALUES ('client','FIX','fix','FIX','Fixture','','','admin','admin',NOW());
INSERT INTO Invoice(id,invNo,createdBy,updatedAt) VALUES ('inv','FIX-INV','admin',NOW());
INSERT INTO `Order`(id,invoiceId,orderNo,amount,orderBalance,customerId,createdBy,updatedAt) VALUES ('ord','inv','FIX-01',1000,750,'client','admin',NOW());
INSERT INTO Receipt(id,orderId,receiptNo,usd,status,imageUrl,createdBy,updatedAt) VALUES
 ('r1','ord','FIX-R1',250,'RECEIVED','/upload/images/receipt.bin','admin',NOW()),('draft','ord','FIX-DRAFT',50,'SIGNING_PENDING',NULL,'admin',NOW());
INSERT INTO Detail(id,totalAmount,imageUrl,createdBy,updatedAt) VALUES ('detail',250,'/upload/images/detail.bin','admin',NOW());
INSERT INTO DetailItem(id,detailId,amount,receiptId) VALUES ('li1','detail',250,'r1');
INSERT INTO Swift(id,detailId,amount,imageUrl,createdBy,updatedAt) VALUES ('s1','detail',250,'/upload/images/swift.bin','admin',NOW());
INSERT INTO ReceiptEditRequest(id,receiptId,status,requestedBy,approvedBy,beforeSnapshot,afterSnapshot,updatedAt)
 VALUES ('decision','r1','APPROVED','admin','admin','{"usd":240}','{"usd":250}',NOW());
INSERT INTO AuditLog(id,action,targetType,targetId,actorId) VALUES ('audit','APPROVE','ReceiptEditRequest','decision','admin');
""")

    def second(self):
        self.sql("""
INSERT INTO Receipt(id,orderId,receiptNo,usd,status,imageUrl,createdBy,updatedAt) VALUES
 ('r2','ord','FIX-R2',100,'RECEIVED','/upload/images/second.bin','admin',NOW());
UPDATE `Order` SET orderBalance=650 WHERE id='ord';
UPDATE Detail SET totalAmount=350 WHERE id='detail';
INSERT INTO DetailItem(id,detailId,amount,receiptId) VALUES ('li2','detail',100,'r2');
INSERT INTO Swift(id,detailId,amount,imageUrl,createdBy,updatedAt) VALUES ('s2','detail',100,'/upload/images/second.bin','admin',NOW());
""")

    def witness(self):
        names = self.sql("SHOW TABLES").splitlines()
        counts = {n: int(self.sql("SELECT COUNT(*) FROM `" + n + "`")) for n in names}
        data = subprocess.check_output(
            self.cmd(
                "mariadb-dump",
                "-uroot",
                "--no-create-info",
                "--compact",
                "--skip-extended-insert",
                "--order-by-primary",
                "--skip-comments",
                "trading_ledger",
            )
        )
        money = self.sql("""SELECT o.amount,o.orderBalance,
         (SELECT SUM(r.usd) FROM Receipt r WHERE r.orderId=o.id AND r.status<>'SIGNING_PENDING'),
         d.totalAmount,(SELECT SUM(i.amount) FROM DetailItem i JOIN Receipt r ON r.id=i.receiptId WHERE i.detailId=d.id),
         (SELECT SUM(s.amount) FROM Swift s WHERE s.detailId=d.id)
         FROM `Order` o JOIN Invoice v ON o.invoiceId=v.id JOIN Customer c ON c.id=o.customerId JOIN Detail d ON d.id='detail' WHERE o.id='ord'""")
        nums = [float(x) for x in money.split()]
        assert nums[0] - nums[1] == nums[2] and nums[2] == nums[3] == nums[4] == nums[5]
        assert (
            self.sql(
                "SELECT COUNT(*) FROM ReceiptEditRequest r JOIN AuditLog a ON a.targetId=r.id AND r.approvedBy=a.actorId WHERE r.status='APPROVED'"
            )
            == "1"
        )
        refs = self.sql(
            "SELECT imageUrl FROM Receipt WHERE imageUrl IS NOT NULL UNION SELECT imageUrl FROM Detail UNION SELECT imageUrl FROM Swift"
        ).splitlines()
        return {
            "table_counts": counts,
            "all_rows_hash": hashlib.sha256(data).hexdigest(),
            "money": money,
            "refs": sorted(refs),
        }

    def close(self):
        if self.cid:
            check = subprocess.check_output(
                [
                    "docker",
                    "inspect",
                    "--format",
                    '{{index .Config.Labels "muledger.offsite.task"}}',
                    self.cid,
                ],
                text=True,
            ).strip()
            assert check == self.tag
            subprocess.run(
                ["docker", "rm", "-f", self.cid], check=True, stdout=subprocess.DEVNULL
            )
            self.cid = None
