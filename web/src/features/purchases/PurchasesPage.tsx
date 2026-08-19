import { useLocation } from 'react-router-dom';
import { PurchaseOrdersList } from './purchase-orders/PurchaseOrdersList';
import { BillsList } from './bills/BillsList';

export function PurchasesPage() {
  const location = useLocation();
  const isBillsRoute = location.pathname.includes('/bills');

  if (isBillsRoute) {
    return <BillsList />;
  }
  return <PurchaseOrdersList />;
}
