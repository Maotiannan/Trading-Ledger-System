import type { CustomerOutstandingStatementLabels } from './customer-outstanding-export-image';

export function customerOutstandingStatementLabels(language: 'en' | 'fr'): CustomerOutstandingStatementLabels {
  const french = language === 'fr';
  return {
    title: french ? 'État des encours client' : 'Customer Outstanding Statement',
    customer: french ? 'Client' : 'Customer',
    statementDate: french ? 'Date du relevé' : 'Statement Date',
    totalUnpaid: french ? 'Total impayé' : 'Total Unpaid',
    released: french ? 'Commandes libérées' : 'Released Orders',
    inTransit: french ? 'Commandes en transit' : 'In-Transit Orders',
    orderNo: french ? 'N° DE COMMANDE' : 'ORDER NO',
    balance: french ? 'SOLDE' : 'BALANCE',
    days: french ? 'JOURS' : 'DAYS',
    subtotal: french ? 'Sous-total' : 'Subtotal',
    contactNote: french ? 'Veuillez contacter MU Group si une information est incorrecte.' : 'Please contact MU Group if any information is incorrect.',
  };
}
