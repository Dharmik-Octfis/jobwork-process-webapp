import { apiClient } from '../../api/client';
import { endpoints } from '../../api/endpoints';

export interface InventoryValuationQuery {
  asOfDate?: string;
  stockAvailability?: 'none' | 'gt' | 'lte' | 'lt' | 'eq' | 'neq';
  status?: 'all' | 'active' | 'inactive';
  itemName?: string;
  categoryName?: string;
  locationId?: string;
  sku?: string;
  hsnCode?: string;
  itemCustomFields?: Record<string, unknown>;
  page?: number;
  perPage?: number;
}

export interface InventoryValuationRow {
  itemId: string;
  itemName: string;
  sku: string | null;
  hsnCode: string | null;
  categoryName: string | null;
  uomName: string | null;
  customFields: Record<string, unknown>;
  stockOnHand: number;
  inventoryAssetValue: number;
}

export interface PaginatedInventoryValuationResponse {
  results: InventoryValuationRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalQty: number;
  grandTotalValue: number;
}

export interface StockSummaryQuery {
  fromDate?: string;
  toDate?: string;
  status?: 'all' | 'active' | 'inactive';
  itemName?: string;
  categoryName?: string;
  locationId?: string;
  sku?: string;
  hsnCode?: string;
  itemCustomFields?: Record<string, unknown>;
  page?: number;
  perPage?: number;
}

export interface StockSummaryRow {
  itemId: string;
  itemName: string;
  sku: string | null;
  hsnCode: string | null;
  categoryName: string | null;
  uomName: string | null;
  customFields: Record<string, unknown>;
  openingStock: number;
  quantityIn: number;
  quantityOut: number;
  closingStock: number;
}

export interface PaginatedStockSummaryResponse {
  results: StockSummaryRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalOpening: number;
  grandTotalIn: number;
  grandTotalOut: number;
  grandTotalClosing: number;
}

export interface ItemLedgerQuery {
  locationId?: string;
  fromDate?: string;
  toDate?: string;
}

export interface ItemLedgerRow {
  date: string | null;
  transactionDetails: string;
  quantity: number;
  unitCost: number | null;
  totalCost: number;
  /** Null on the first row of a value adjustment's out/in pair. */
  stockOnHand: number | null;
  inventoryAssetValue: number | null;
  isOpeningStock?: boolean;
  isClosingStock?: boolean;
  sourceDocType?: string | null;
  sourceDocId?: string | null;
  sourceDocNumber?: string | null;
  isCancellation?: boolean;
}

export interface ItemLedgerResponse {
  itemInfo: {
    itemName: string;
    sku: string | null;
    uomName: string | null;
  };
  rows: ItemLedgerRow[];
}

export interface FifoCostLotTrackingQuery {
  fromDate?: string;
  toDate?: string;
  itemName?: string;
  locationName?: string;
  page?: number;
  perPage?: number;
  reportBasis?: 'product_in' | 'product_out';
}

export interface PaginatedFifoCostLotTrackingResponse {
  results: FifoCostLotTrackingRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
}

export interface FifoCostLotTrackingRow {
  /** One lot = one document's stock at one cost; rows sharing it are its dispersals. */
  lotKey: string;
  inDate: string | null;
  inTransaction: string;
  inReceivedFrom: string;
  inQty: number | null;
  inQtyUnit: string;
  inQtyRemaining: number;
  inAge: string;
  inCost: string;
  inTotal: string;

  inDocType: string;
  inDocId: string;

  inPartyId: string | null;
  inPartyType: 'vendor' | 'customer' | null;
  itemName?: string;

  outDate: string | null;
  outTransaction: string;
  outDispersedTo: string;
  outQty: number | null;
  outQtyUnit: string;

  outDocType: string;
  outDocId: string;
  outPartyId: string | null;
  outPartyType: 'vendor' | 'customer' | null;
}

export interface StockMovementQuery {
  itemId?: string;
  locationId?: string;
  fromDate?: string;
  toDate?: string;
  movementType?: 'all' | 'inward' | 'outward';
  page?: number;
  perPage?: number;
}

export interface StockMovementRow {
  id: string;
  transactionDate: string;
  transactionNumber: string;
  itemId: string;
  itemName: string;
  createdAt: string;
  transactionType: string;
  movementType: 'Inward' | 'Outward';
  source: string;
  destination: string;
  quantity: number;
  sourceDocId?: string | null;
}

export interface PaginatedStockMovementResponse {
  results: StockMovementRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalQuantity: number;
}

export interface JobOrderLossQuery {
  fromDate?: string;
  toDate?: string;
  itemName?: string;
  processorName?: string;
  jobOrderNumber?: string;
  page?: number;
  perPage?: number;
}

/** One challan line's write-off — what a completed or short-closed step left at the processor. */
export interface JobOrderLossRow {
  id: string;
  writtenOffAt: string;
  jobOrderId: string;
  jobOrderNumber: string;
  stepSeq: number;
  processName: string;
  closedAs: string;
  jobIssueId: string | null;
  challanNumber: string | null;
  processorName: string | null;
  itemId: string;
  itemName: string;
  uomName: string | null;
  batchNumber: string | null;
  qty: number;
  value: number;
  reason: string | null;
}

export interface PaginatedJobOrderLossResponse {
  results: JobOrderLossRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalValue: number;
}

/** Stable report ids from the backend catalog (`reports.catalog.ts`) — never the label or path. */
export type ReportKey =
  | 'stock_summary'
  | 'inventory_valuation_summary'
  | 'fifo_cost_lot_tracking'
  | 'job_order_loss'
  | 'batch_report'
  | 'taka_report'
  | 'jobwork_challan_report'
  | 'jobwork_receipt_report'
  | 'job_order_report'
  | 'customer_report'
  | 'vendor_report'
  | 'purchase_order_report'
  | 'bill_report';

export interface JobOrdersReportQuery {
  page?: number;
  perPage?: number;
  jobOrderNumber?: string;
  processorName?: string;
  processName?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  targetDateFrom?: string;
  targetDateTo?: string;
  routeName?: string;
  ownership?: string;
  processorType?: string;
  jobOrderCustomFields?: Record<string, unknown>;
}

export interface JobOrdersReportRow {
  id: string;
  jobOrderNumber: string;
  orderDate: string;
  targetDate: string | null;
  route: string;
  materialBelongsTo: string;
  status: string;
  process: string[];
  doneBy: string[];
  processorName: string[];
}

export interface PaginatedJobOrdersReportResponse {
  results: JobOrdersReportRow[];
  totalCount: number;
  page: number;
  pageSize: number;
}

export interface JobworkChallansQuery {
  page?: number;
  perPage?: number;
  processorName?: string;
  processName?: string;
  jobOrderNumber?: string;
  itemName?: string;
  fromDate?: string;
  toDate?: string;
  openOnly?: boolean;
  minAgeDays?: number;
}

export interface JobworkChallanRow {
  id: string;
  challanNumber: string;
  issueDate: string;
  processorName: string;
  process: string;
  jobOrderNumber: string;
  jobOrderId: string;
  lines: {
    id: string;
    itemId: string;
    items: string;
    plannedQty: number;
    issuedQty: number;
    toBeIssuedQty: number;
  }[];
  daysOutstanding: number | null;
  status: string;
}

export interface PaginatedJobworkChallansResponse {
  results: JobworkChallanRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalValue?: number;
}

export interface JobworkReceiptsQuery {
  page?: number;
  perPage?: number;
  processorName?: string;
  processName?: string;
  jobOrderNumber?: string;
  itemName?: string;
  fromDate?: string;
  toDate?: string;
  minAgeDays?: number;
}

export interface JobworkReceiptRow {
  id: string;
  receiptNumber: string;
  receiptDate: string;
  processorName: string;
  process: string;
  jobOrderNumber: string;
  jobOrderId: string;
  lines: {
    id: string;
    itemId: string;
    items: string;
    plannedQty: number;
    receivedQty: number;
    toBeReceivedQty: number;
  }[];
  status: string;
  processChargeTotal?: number;
}

export interface PaginatedJobworkReceiptsResponse {
  results: JobworkReceiptRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalValue?: number;
}

export interface BatchReportQuery {
  page?: number;
  perPage?: number;
  itemName?: string;
  locationName?: string;
  batchText?: string;
  state?: string;
  asOnDate?: string;
  fromDate?: string;
  toDate?: string;
  minAgeDays?: number;
}

export interface BatchReportRow {
  id: string;
  batch: string | null;
  itemId: string;
  itemName: string;
  locationName: string;
  qty: number;
  takaCount: number | null;
  untaggedQty: number | null;
  receivedOn: string | null;
  ageDays: number | null;
  sourceDocType: string | null;
  sourceDocNumber: string | null;
  sourceDocId: string | null;
  state: string;
  batchNumber: string;
  value: number;
  avgRate: number;
  parentBatches: string | null;
}

export interface PaginatedBatchReportResponse {
  results: BatchReportRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalValue: number;
}

export interface TakaReportQuery {
  page?: number;
  perPage?: number;
  itemName?: string;
  locationName?: string;
  batchText?: string;
  onlyAtJobWorkers?: boolean;
  asOnDate?: string;
  fromDate?: string;
  toDate?: string;
  minAgeDays?: number;
}

export interface TakaReportRow {
  id: string;
  label: string;
  itemId: string;
  itemName: string;
  batch: string;
  locationName: string;
  qty: number;
  receivedOn: string | null;
  daysAtLocation: number | null;
  sourceDocType: string | null;
  sourceDocNumber: string | null;
  sourceDocId: string | null;
  receivedQty: number | null;
  challanNumber: string | null;
  value: number;
}

export interface PaginatedTakaReportResponse {
  results: TakaReportRow[];
  total: number;
  page: number;
  perPage: number;
  totalPages: number;
  grandTotalValue: number;
}

export interface CustomersReportQuery {
  page?: number;
  perPage?: number;
  contactNumber?: string;
  companyName?: string;
  status?: string;
  customerType?: string;
}

export interface CustomersReportRow {
  id: string;
  contactNumber: string;
  customerType: string | null;
  companyName: string | null;
  contactName: string;
  primaryContact: string | null;
  email: string | null;
  phone: string | null;
  currency: string | null;
  paymentTerms: string | null;
  notes: string | null;
  [key: string]: unknown;
}

export interface PaginatedCustomersReportResponse {
  items: CustomersReportRow[];
  pagination: {
    totalCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface VendorsReportQuery {
  page?: number;
  perPage?: number;
  contactNumber?: string;
  companyName?: string;
  status?: string;
  vendorType?: string;
}

export interface VendorsReportRow {
  id: string;
  contactNumber: string;
  companyName: string | null;
  contactName: string;
  primaryContact: string | null;
  email: string | null;
  phone: string | null;
  currency: string | null;
  paymentTerms: string | null;
  notes: string | null;
  [key: string]: unknown;
}

export interface PaginatedVendorsReportResponse {
  items: VendorsReportRow[];
  pagination: {
    totalCount: number;
    page: number;
    pageSize: number;
    totalPages: number;
  };
}

export interface ReportListEntry {
  key: ReportKey;
  name: string;
  category: string;
  /** Page path under `/organizations/:orgId/reports/`. */
  path: string;
  /** ISO timestamp; null until this user opens the report in this organization. */
  lastVisitedAt: string | null;
  isFavorite: boolean;
}

export const reportsCenterQueryKey = (orgId: string) => ['reports', orgId, 'center'] as const;

export const reportsApi = {
  listReports: async (orgId: string): Promise<ReportListEntry[]> => {
    const response = await apiClient.get(endpoints.reports.list(orgId));
    return response.data as ReportListEntry[];
  },
  recordVisit: async (orgId: string, reportKey: ReportKey): Promise<void> => {
    await apiClient.post(endpoints.reports.visit(orgId, reportKey));
  },
  setFavorite: async (orgId: string, reportKey: ReportKey, isFavorite: boolean): Promise<void> => {
    await apiClient.put(endpoints.reports.favorite(orgId, reportKey), { isFavorite });
  },
  getStockMovement: async (
    orgId: string,
    params: StockMovementQuery = {},
  ): Promise<PaginatedStockMovementResponse> => {
    const response = await apiClient.get(`/organizations/${orgId}/reports/stock-movement`, {
      params,
    });
    return response.data as PaginatedStockMovementResponse;
  },
  getInventoryValuation: async (
    orgId: string,
    params: InventoryValuationQuery = {},
  ): Promise<PaginatedInventoryValuationResponse> => {
    const response = await apiClient.get(endpoints.reports.inventoryValuation(orgId), { params });
    // Assume unwrapped response by client interceptor
    return response.data as PaginatedInventoryValuationResponse;
  },
  getItemLedger: async (
    orgId: string,
    itemId: string,
    params: ItemLedgerQuery = {},
  ): Promise<ItemLedgerResponse> => {
    const response = await apiClient.get(
      `${endpoints.reports.inventoryValuation(orgId)}/${itemId}`,
      { params },
    );
    return response.data as ItemLedgerResponse;
  },
  getFifoCostLotTracking: async (
    orgId: string,
    params: FifoCostLotTrackingQuery = {},
  ): Promise<PaginatedFifoCostLotTrackingResponse> => {
    const response = await apiClient.get(endpoints.reports.fifoCostLotTracking(orgId), { params });
    return response.data as PaginatedFifoCostLotTrackingResponse;
  },
  getJobOrderLoss: async (
    orgId: string,
    params: JobOrderLossQuery = {},
  ): Promise<PaginatedJobOrderLossResponse> => {
    const response = await apiClient.get(endpoints.reports.jobOrderLoss(orgId), { params });
    return response.data as PaginatedJobOrderLossResponse;
  },
  getStockSummary: async (
    orgId: string,
    params: StockSummaryQuery = {},
  ): Promise<PaginatedStockSummaryResponse> => {
    // Note: endpoint needs to be added in endpoints.ts, for now using a placeholder or assuming it exists
    const response = await apiClient.get(`/organizations/${orgId}/reports/stock-summary`, {
      params,
    });
    return response.data as PaginatedStockSummaryResponse;
  },
  getBatchReport: async (
    orgId: string,
    params: BatchReportQuery = {},
  ): Promise<PaginatedBatchReportResponse> => {
    const response = await apiClient.get(endpoints.reports.batchReport(orgId), { params });
    return response.data as PaginatedBatchReportResponse;
  },
  getTakaReport: async (
    orgId: string,
    params: TakaReportQuery = {},
  ): Promise<PaginatedTakaReportResponse> => {
    const response = await apiClient.get(endpoints.reports.takaReport(orgId), { params });
    return response.data as PaginatedTakaReportResponse;
  },
  getJobworkChallans: async (
    orgId: string,
    params: JobworkChallansQuery = {},
  ): Promise<PaginatedJobworkChallansResponse> => {
    const response = await apiClient.get(endpoints.reports.jobworkChallans(orgId), { params });
    return response.data as PaginatedJobworkChallansResponse;
  },
  getJobworkReceipts: async (
    orgId: string,
    params: JobworkReceiptsQuery = {},
  ): Promise<PaginatedJobworkReceiptsResponse> => {
    const response = await apiClient.get(endpoints.reports.jobworkReceipts(orgId), { params });
    return response.data as PaginatedJobworkReceiptsResponse;
  },
  getJobOrdersReport: async (
    orgId: string,
    params: JobOrdersReportQuery = {},
  ): Promise<PaginatedJobOrdersReportResponse> => {
    const response = await apiClient.get(endpoints.reports.jobOrdersReport(orgId), { params });
    return response.data as PaginatedJobOrdersReportResponse;
  },
  getCustomersReport: async (
    orgId: string,
    params: CustomersReportQuery = {},
  ): Promise<PaginatedCustomersReportResponse> => {
    const response = await apiClient.get(`/organizations/${orgId}/reports/customers`, { params });
    return response.data as PaginatedCustomersReportResponse;
  },
  getVendorsReport: async (
    orgId: string,
    params: VendorsReportQuery = {},
  ): Promise<PaginatedVendorsReportResponse> => {
    const response = await apiClient.get(`/organizations/${orgId}/reports/vendors`, { params });
    return response.data as PaginatedVendorsReportResponse;
  },
  getPurchaseOrdersReport: async (
    orgId: string,
    params: PurchaseOrdersReportQuery = {},
  ): Promise<PaginatedPurchaseOrdersReportResponse> => {
    const response = await apiClient.get(endpoints.reports.purchaseOrdersReport(orgId), { params });
    return response.data as PaginatedPurchaseOrdersReportResponse;
  },
  getBillsReport: async (
    orgId: string,
    params: BillsReportQuery = {},
  ): Promise<PaginatedBillsReportResponse> => {
    const response = await apiClient.get(endpoints.reports.billsReport(orgId), { params });
    return response.data as PaginatedBillsReportResponse;
  },
};

export interface PurchaseOrdersReportQuery {
  vendorId?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  deliveryType?: string;
  poNumber?: string;
  vendorName?: string;
  purchaseOrderCustomFields?: Record<string, unknown>;
  page?: number;
  perPage?: number;
}

export interface PurchaseOrdersReportRow {
  id: string;
  vendorId: string;
  poNumber: string;
  vendorName: string;
  locationName: string;
  deliveryType: string;
  deliveryAddress: string;
  date: string;
  deliveryDate: string | null;
  paymentTerms: string | null;
  total: number;
  status: string;
  customFields: Record<string, unknown>;
}

export interface PaginatedPurchaseOrdersReportResponse {
  items: PurchaseOrdersReportRow[];
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}

export interface BillsReportQuery {
  vendorId?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  billNumber?: string;
  vendorName?: string;
  locationName?: string;
  paymentTerms?: string;
  fromDeliveryDate?: string;
  toDeliveryDate?: string;
  total?: string;
  billCustomFields?: Record<string, unknown>;
  page?: number;
  perPage?: number;
}

export interface BillsReportRow {
  id: string;
  vendorId: string;
  billNumber: string;
  vendorName: string;
  locationName: string;
  date: string;
  deliveryDate: string | null;
  paymentTerms: string | null;
  total: number;
  status: string;
  customFields: Record<string, unknown>;
}

export interface PaginatedBillsReportResponse {
  items: BillsReportRow[];
  totalAmount?: number;
  pagination: {
    page: number;
    pageSize: number;
    totalCount: number;
    totalPages: number;
  };
}
