export const name = 'auth-hierarchy-boundaries';

export default async function run(t) {
  await t.initAdmin();
  await t.loginAdmin();

  const suffix = t.unique('hierarchy');
  const adminAEmail = `${suffix}-admin-a@example.com`;
  const adminBEmail = `${suffix}-admin-b@example.com`;
  const salesAEmail = `${suffix}-sales-a@example.com`;
  const salesBEmail = `${suffix}-sales-b@example.com`;
  const userAEmail = `${suffix}-user-a@example.com`;
  const userBEmail = `${suffix}-user-b@example.com`;
  const userCEmail = `${suffix}-user-c@example.com`;

  const adminA = await t.createUser({
    email: adminAEmail,
    password: 'AdminA@2026!',
    role: 'ADMIN',
    name: `Admin A ${suffix}`,
  });
  const adminAId = String(adminA.data?.data?.id || '');
  t.assertOk(Boolean(adminAId), 'root admin can create level-2 admin A');

  const adminB = await t.createUser({
    email: adminBEmail,
    password: 'AdminB@2026!',
    role: 'ADMIN',
    name: `Admin B ${suffix}`,
  });
  const adminBId = String(adminB.data?.data?.id || '');
  t.assertOk(Boolean(adminBId), 'root admin can create level-2 admin B');

  const salesA = await t.createUser({
    email: salesAEmail,
    password: 'SalesA@2026!',
    role: 'SALES',
    name: `Sales A ${suffix}`,
    parentId: adminAId,
  });
  const salesAId = String(salesA.data?.data?.id || '');
  t.assertOk(Boolean(salesAId), 'root admin can create sales under admin A');

  const salesB = await t.createUser({
    email: salesBEmail,
    password: 'SalesB@2026!',
    role: 'SALES',
    name: `Sales B ${suffix}`,
    parentId: adminBId,
  });
  const salesBId = String(salesB.data?.data?.id || '');
  t.assertOk(Boolean(salesBId), 'root admin can create sales under admin B');

  const userA = await t.createUser({
    email: userAEmail,
    password: 'UserA@2026!',
    role: 'USER',
    name: `User A ${suffix}`,
    parentId: salesAId,
  });
  const userAId = String(userA.data?.data?.id || '');
  t.assertOk(Boolean(userAId), 'root admin can create user under sales A');

  const userB = await t.createUser({
    email: userBEmail,
    password: 'UserB@2026!',
    role: 'USER',
    name: `User B ${suffix}`,
    parentId: salesBId,
  });
  const userBId = String(userB.data?.data?.id || '');
  t.assertOk(Boolean(userBId), 'root admin can create user under sales B');

  const userC = await t.createUser({
    email: userCEmail,
    password: 'UserC@2026!',
    role: 'USER',
    name: `User C ${suffix}`,
    parentId: salesAId,
  });
  const userCId = String(userC.data?.data?.id || '');
  t.assertOk(Boolean(userCId), 'root admin can create second user under sales A');

  await t.logout();
  await t.login(adminAEmail, 'AdminA@2026!');

  const adminCreateDenied = await t.createUser({
    email: `${suffix}-blocked-admin@example.com`,
    password: 'Blocked@2026!',
    role: 'ADMIN',
    name: 'Blocked Admin',
  }, 403);
  t.assertMatch(adminCreateDenied.data?.error || adminCreateDenied.text, /无权创建该角色|不能创建该角色/, 'level-2 admin cannot create admin');

  const adminList = await t.auth({ action: 'list' }, 200);
  const adminRows = Array.isArray(adminList.data?.data) ? adminList.data.data : [];
  t.assertOk(adminRows.some((row) => row.id === adminBId), 'same-level admin is visible in user list');
  t.assertOk(adminRows.some((row) => row.id === salesAId), 'descendant sales is visible in user list');

  const updateSiblingDenied = await t.auth({
    action: 'update-role',
    userId: adminBId,
    role: 'SALES',
  }, 403);
  t.assertMatch(updateSiblingDenied.data?.error || updateSiblingDenied.text, /同级|下级/, 'level-2 admin cannot update same-level admin');

  const resetSiblingDenied = await t.auth({
    action: 'reset-password',
    userId: adminBId,
    password: 'Reset@2026!',
  }, 403);
  t.assertMatch(resetSiblingDenied.data?.error || resetSiblingDenied.text, /下级/, 'level-2 admin cannot reset same-level admin password');

  const deleteSiblingDenied = await t.auth({
    action: 'delete',
    userId: adminBId,
  }, 403);
  t.assertMatch(deleteSiblingDenied.data?.error || deleteSiblingDenied.text, /下级/, 'level-2 admin cannot delete same-level admin');

  await t.logout();
  await t.login(salesAEmail, 'SalesA@2026!');

  const salesCreateDenied = await t.createUser({
    email: `${suffix}-blocked-sales@example.com`,
    password: 'Blocked@2026!',
    role: 'SALES',
    name: 'Blocked Sales',
  }, 403);
  t.assertMatch(salesCreateDenied.data?.error || salesCreateDenied.text, /无权创建该角色|不能创建该角色/, 'sales cannot create sales accounts');

  const ownUserReset = await t.auth({
    action: 'reset-password',
    userId: userAId,
    password: 'UserA-reset@2026!',
  }, 200);
  t.assertEqual(Boolean(ownUserReset.data?.success), true, 'sales can reset descendant user password');

  const siblingUserResetDenied = await t.auth({
    action: 'reset-password',
    userId: userBId,
    password: 'UserB-reset@2026!',
  }, 403);
  t.assertMatch(siblingUserResetDenied.data?.error || siblingUserResetDenied.text, /下级/, 'sales cannot reset another branch user password');

  const ownUserDelete = await t.auth({
    action: 'delete',
    userId: userCId,
  }, 200);
  t.assertEqual(Boolean(ownUserDelete.data?.success), true, 'sales can delete descendant user');

  const deletedUserCheck = await t.auth({ action: 'list' }, 200);
  const deletedUserRows = Array.isArray(deletedUserCheck.data?.data) ? deletedUserCheck.data.data : [];
  t.assertOk(!deletedUserRows.some((row) => row.id === userCId), 'deleted descendant user disappears from list');

  await t.logout();
  await t.login(userBEmail, 'UserB@2026!');

  const userCreateDenied = await t.createUser({
    email: `${suffix}-blocked-user@example.com`,
    password: 'Blocked@2026!',
    role: 'USER',
    name: 'Blocked User',
  }, 403);
  t.assertMatch(userCreateDenied.data?.error || userCreateDenied.text, /无权限/, 'user cannot create accounts');

  await t.logout();
}
