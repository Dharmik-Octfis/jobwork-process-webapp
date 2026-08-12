import { formatQty } from '../jobwork.schemas';
import type { JobIssue } from './jobIssues.schemas';

/**
 * The printable delivery challan.
 *
 * 🔴 NOT DEFERRABLE. Goods cannot legally move without one (plan §6) — this is
 * the document that travels in the vehicle, and it is what a GST officer asks for
 * at a checkpoint.
 *
 * WHY IT PRINTS IN A NEW WINDOW INSTEAD OF THE PAGE
 *
 * The app's layout is a fixed sidebar, a fixed header and a scrolling pane, all
 * inline-styled. Printing the page itself means fighting every one of those with
 * `@media print` overrides that nothing tests and that break the first time a
 * layout style changes. A standalone document has no such context: what is in the
 * string is exactly what comes out of the printer, in every browser, and "Save as
 * PDF" in the print dialog produces the PDF.
 *
 * ⚠️ NO TRANSPORT BLOCK (2026-08-10). Vehicle, LR and e-way bill number were
 * dropped from `job_issues` altogether, so the challan prints without them — the
 * driver's details go on whatever the transporter issues. Restoring them means
 * restoring the columns and the dialog fields first, not just this markup.
 *
 * 🔴 EVERY PARTY DETAIL COMES FROM THE SNAPSHOT COLUMNS, never from a join
 * (field-sources §2.4). Sunrise Dyers moves premises in October; reprinting
 * August's challan must show the August address, because that is where the goods
 * went and what the e-way bill was raised against. Reading a live vendor row here
 * would silently rewrite history every time someone hit Print.
 */

function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildChallanHtml(issue: JobIssue, orgName: string): string {
  /**
   * 🔴 THE ITEM IS A COLUMN, and the unit comes off the LINE (§5.7).
   *
   * One challan carries fabric, thread and buttons. Printing one header unit
   * against every row would put "CONE" beside 100 metres of fabric on the
   * document the goods physically travel with — and that is what a checkpoint and
   * the receiving processor read. There is no header unit left to fall back to
   * (dropped 2026-08-12), which is the correct end state: a row with no unit
   * prints none rather than borrowing another item's.
   */
  const unitOf = (line: JobIssue['lines'][number]) =>
    line.uom ? (line.uom.symbol ?? line.uom.unitName) : '';

  const rows = issue.lines
    .map((line, index) => {
      const taka = line.lotPackage
        ? escapeHtml(
            line.lotPackage.label ?? `${line.lot?.lotNumber}/${line.lotPackage.packageNumber}`,
          )
        : '—';
      return `<tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(line.item?.name ?? '')}</td>
        <td>${escapeHtml(line.lot?.lotNumber ?? '')}</td>
        <td>${escapeHtml(line.lot?.supplierLotRef ?? '')}</td>
        <td>${taka}</td>
        <td class="num">${formatQty(line.qty)} ${escapeHtml(unitOf(line))}</td>
      </tr>`;
    })
    .join('');

  /** Totalled per item, in each item's own unit — never one sum. */
  const totals = new Map<string, { name: string; unit: string; qty: number }>();
  for (const line of issue.lines) {
    const name = line.item?.name ?? '';
    const existing = totals.get(name) ?? { name, unit: unitOf(line), qty: 0 };
    existing.qty += Number(line.qty);
    totals.set(name, existing);
  }
  const totalText = [...totals.values()]
    .map((row) => `${formatQty(row.qty)} ${escapeHtml(row.unit)} ${escapeHtml(row.name)}`)
    .join(' · ');

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Challan ${escapeHtml(issue.challanNumber)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; margin: 0; padding: 24px; font-size: 12px; }
  h1 { font-size: 18px; margin: 0 0 2px 0; }
  .sub { font-size: 11px; color: #555; }
  .title { text-align: center; font-size: 14px; font-weight: 600; letter-spacing: 1px; text-transform: uppercase; margin: 16px 0; padding: 6px 0; border-top: 1px solid #111; border-bottom: 1px solid #111; }
  .grid { display: flex; gap: 24px; margin-bottom: 16px; }
  .box { flex: 1; border: 1px solid #999; padding: 10px 12px; }
  .box h2 { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #555; margin: 0 0 6px 0; }
  .box p { margin: 0 0 2px 0; line-height: 1.5; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { border: 1px solid #999; padding: 6px 8px; text-align: left; }
  th { background: #f2f2f2; font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px; }
  td.num, th.num { text-align: right; }
  tfoot td { font-weight: 600; }
  .note { margin-top: 16px; font-size: 10px; color: #555; line-height: 1.6; }
  .signs { display: flex; justify-content: space-between; margin-top: 48px; font-size: 11px; }
  .signs div { width: 30%; border-top: 1px solid #111; padding-top: 4px; text-align: center; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>${escapeHtml(orgName)}</h1>
  <div class="sub">Delivery challan for jobwork — goods sent for processing, to be returned</div>

  <div class="title">Delivery Challan · ${escapeHtml(issue.challanNumber)}</div>

  <div class="grid">
    <div class="box">
      <h2>Sent to</h2>
      <p><strong>${escapeHtml(issue.processorNameSnapshot ?? '')}</strong></p>
      <p>${escapeHtml(issue.processorAddressSnapshot ?? '')}</p>
      ${issue.processorGstinSnapshot ? `<p>GSTIN: ${escapeHtml(issue.processorGstinSnapshot)}</p>` : ''}
    </div>
    <div class="box">
      <h2>Details</h2>
      <p>Date: ${new Date(issue.issueDate).toLocaleDateString()}</p>
      <p>Job order: ${escapeHtml(issue.jobOrder?.jobOrderNumber ?? '')}</p>
      <p>Process: ${escapeHtml(issue.step?.processNameSnapshot ?? '')}</p>
      <p>From: ${escapeHtml(issue.sourceLocation?.name ?? '')}</p>
      <p>To: ${escapeHtml(issue.destination?.name ?? '')}</p>
      ${issue.isRework ? `<p><strong>Rework — attempt ${issue.attemptNo}</strong></p>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:36px">#</th>
        <th>Item</th>
        <th>Lot</th>
        <th>Party ref</th>
        <th>Taka</th>
        <th class="num">Quantity</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="5">Total — ${issue.lines.length} line${issue.lines.length === 1 ? '' : 's'}</td>
        <td class="num">${totalText}</td>
      </tr>
    </tfoot>
  </table>

  ${issue.remarks ? `<div class="note">Remarks: ${escapeHtml(issue.remarks)}</div>` : ''}

  <div class="note">
    Goods described above are sent for jobwork and remain the property of the sender. They are to be
    returned after processing within the period allowed under the applicable GST rules.
  </div>

  <div class="signs">
    <div>Prepared by</div>
    <div>Driver / transporter</div>
    <div>Received by</div>
  </div>
</body>
</html>`;
}

/**
 * Open the challan in its own window and put the print dialog up.
 *
 * Returns false when the browser blocked the popup, so the caller can say so —
 * a Print button that silently does nothing is the worst possible outcome for a
 * document a truck is waiting on.
 */
export function printChallan(issue: JobIssue, orgName: string): boolean {
  const win = window.open('', '_blank', 'width=900,height=1000');
  if (!win) return false;

  win.document.write(buildChallanHtml(issue, orgName));
  win.document.close();
  // `onload` rather than an immediate call: printing before layout settles gives
  // a blank first page in Safari and Firefox.
  win.onload = () => {
    win.focus();
    win.print();
  };
  return true;
}
