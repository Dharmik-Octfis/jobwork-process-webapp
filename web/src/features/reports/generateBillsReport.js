const fs = require('fs');
const poContent = fs.readFileSync('e:/octfis-project/jobwork-process-webapp/web/src/features/reports/PurchaseOrdersReportPage.tsx', 'utf-8');

let billsContent = poContent
  .replace(/PurchaseOrdersReportPage/g, 'BillsReportPage')
  .replace(/PurchaseOrdersReportState/g, 'BillsReportState')
  .replace(/purchase_order_report/g, 'bill_report')
  .replace(/purchase_order/g, 'bill')
  .replace(/PurchaseOrdersReportQuery/g, 'BillsReportQuery')
  .replace(/PurchaseOrdersReportRow/g, 'BillsReportRow')
  .replace(/Purchase Order Report/g, 'Bill Report')
  .replace(/Purchase Order/g, 'Bill')
  .replace(/Purchase Orders/g, 'Bills')
  .replace(/purchaseOrders/g, 'bills')
  .replace(/getPurchaseOrdersReport/g, 'getBillsReport')
  .replace(/purchaseOrderCustomFields/g, 'billCustomFields')
  .replace(/poNumber/g, 'billNumber')
  .replace(/PO Number/g, 'Bill Number')
  .replace(/PO NUMBER/g, 'BILL NUMBER')
  .replace(/poData/g, 'billData')
  .replace(/po/g, 'bill')
  .replace(/purchases\/purchase-orders/g, 'purchases/bills');

// Now adjust the columns
billsContent = billsContent.replace(
  /const COLUMN_CATALOG = \[[\s\S]*?\];/,
  `const COLUMN_CATALOG = [
  { key: 'billNumber', label: 'BILL NUMBER', locked: true, defaultVisible: true },
  { key: 'vendorName', label: 'VENDOR NAME', defaultVisible: true },
  { key: 'locationName', label: 'LOCATION', defaultVisible: true },
  { key: 'date', label: 'DATE', defaultVisible: true },
  { key: 'paymentTerms', label: 'PAYMENT TERMS', defaultVisible: true },
  { key: 'deliveryDate', label: 'DELIVERY DATE', defaultVisible: true },
  { key: 'total', label: 'TOTAL', defaultVisible: true },
  { key: 'status', label: 'STATUS', defaultVisible: true },
];`
);

// Remove deliveryType from query fields
billsContent = billsContent.replace(/\{ key: 'deliveryType', label: 'Delivery Type', dataType: 'select', options: deliveryTypeOptions, group: 'Report' \},/g, '');
billsContent = billsContent.replace(/deliveryType: valueOf\('deliveryType'\),/g, '');

// Also remove deliveryTypeOptions array
billsContent = billsContent.replace(/const deliveryTypeOptions = \[\s*\{ label: 'Location', value: 'Location' \},\s*\{ label: 'Customer', value: 'Customer' \},\s*\];/g, '');

fs.writeFileSync('e:/octfis-project/jobwork-process-webapp/web/src/features/reports/BillsReportPage.tsx', billsContent);
console.log('Done!');
