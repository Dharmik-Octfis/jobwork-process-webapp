import jsPDF from 'jspdf';

export interface BarcodeLabelData {
  itemName: string;
  barcodeValue: string;
  secondaryText?: string;
  price?: number | string | null;
  copies?: number;
}

export interface GenerateBarcodePdfOptions {
  itemName?: string;
  barcodeValue?: string;
  secondaryText?: string;
  price?: number | string | null;
  copies?: number;
  labelWidth?: number; // width in mm (default 50)
  labelHeight?: number; // height in mm (default 30)
  labels?: BarcodeLabelData[];
}

// Standard ISO/IEC 15417 Code 128 character patterns (0-106)
// Values 0-105: 11-module patterns (3 bars, 3 spaces)
// Value 106 (Stop): 13-module pattern including the mandatory 2-module termination bar
const CODE128_PATTERNS: string[] = [
  '11011001100', // 0
  '11001101100', // 1
  '11001100110', // 2
  '10010011000', // 3
  '10010001100', // 4
  '10001001100', // 5
  '10011001000', // 6
  '10011000100', // 7
  '10001100100', // 8
  '11001001000', // 9
  '11001000100', // 10
  '11000100100', // 11
  '10110011100', // 12
  '10011011100', // 13
  '10011001110', // 14
  '10111001100', // 15
  '10011101100', // 16
  '10011100110', // 17
  '11001110010', // 18
  '11001011100', // 19
  '11001001110', // 20
  '11011100100', // 21
  '11001110100', // 22
  '11101101110', // 23
  '11101001100', // 24
  '11100101100', // 25
  '11100100110', // 26
  '11101100100', // 27
  '11100110100', // 28
  '11100110010', // 29
  '11011011000', // 30
  '11011000110', // 31
  '11000110110', // 32
  '10100011000', // 33
  '10001011000', // 34
  '10001000110', // 35
  '10110001000', // 36
  '10001101000', // 37
  '10001100010', // 38
  '11010001000', // 39
  '11000101000', // 40
  '11000100010', // 41
  '10110111000', // 42
  '10110001110', // 43
  '10001101110', // 44
  '10111011000', // 45
  '10111000110', // 46
  '10001110110', // 47
  '11101110110', // 48
  '11010001110', // 49
  '11000101110', // 50
  '11011101000', // 51
  '11011100010', // 52
  '11011101110', // 53
  '11101011000', // 54
  '11101000110', // 55
  '11100010110', // 56
  '11101101000', // 57
  '11101100010', // 58
  '11100011010', // 59
  '11101111010', // 60
  '11001000010', // 61
  '11110001010', // 62
  '10100110000', // 63
  '10100001100', // 64
  '10010110000', // 65
  '10010000110', // 66
  '10000101100', // 67
  '10000100110', // 68
  '10110010000', // 69
  '10110000100', // 70
  '10011010000', // 71
  '10011000010', // 72
  '10000110100', // 73
  '10000110010', // 74
  '11000010010', // 75
  '11001010000', // 76
  '11110111010', // 77
  '11000010100', // 78
  '10001111010', // 79
  '10100111100', // 80
  '10010111100', // 81
  '10010011110', // 82
  '10111100100', // 83
  '10011110100', // 84
  '10011110010', // 85
  '11110100100', // 86
  '11110010100', // 87
  '11110010010', // 88
  '11011011110', // 89
  '11011110110', // 90
  '11110110110', // 91
  '10101111000', // 92
  '10100011110', // 93
  '10001011110', // 94
  '10111101000', // 95
  '10111100010', // 96
  '11110101000', // 97
  '11110100010', // 98
  '10111011110', // 99
  '10111101110', // 100
  '11101011110', // 101
  '11110101110', // 102
  '11010000100', // 103 (Start A)
  '11010010000', // 104 (Start B)
  '11010011100', // 105 (Start C)
  '1100011101011', // 106 (Stop + 2-module termination bar)
];

/**
 * Encodes an alphanumeric string into a standard Code 128-B bit pattern.
 * Code 128 Set B natively supports all printable ASCII characters (32 to 126).
 */
export function encodeCode128B(text: string): string {
  const safeText = (text || 'ITEM-001').replace(/[^\x20-\x7E]/g, '') || 'ITEM-001';
  const START_B = 104;
  const STOP = 106;

  const codes: number[] = [START_B];
  let checksumAcc = START_B;

  for (let i = 0; i < safeText.length; i++) {
    const codeVal = safeText.charCodeAt(i) - 32;
    codes.push(codeVal);
    checksumAcc += (i + 1) * codeVal;
  }

  const checksum = checksumAcc % 103;
  codes.push(checksum);
  codes.push(STOP);

  return codes.map((c) => CODE128_PATTERNS[c] || '').join('');
}

function renderNativeCode128(
  doc: jsPDF,
  code: string,
  labelWidth: number,
  maxBarcodeWidth: number,
  barHeight: number,
  y: number,
): void {
  const bitPattern = encodeCode128B(code);
  const moduleWidth = Math.min(0.26, maxBarcodeWidth / bitPattern.length);
  const totalWidth = bitPattern.length * moduleWidth;
  const startX = (labelWidth - totalWidth) / 2;

  let curr = 0;
  while (curr < bitPattern.length) {
    if (bitPattern[curr] === '1') {
      let run = 1;
      while (curr + run < bitPattern.length && bitPattern[curr + run] === '1') {
        run++;
      }
      const barX = startX + curr * moduleWidth;
      const barW = run * moduleWidth;
      doc.rect(barX, y, barW, barHeight, 'F');
      curr += run;
    } else {
      curr++;
    }
  }
}

export function generateBarcodePdfBlob(options: GenerateBarcodePdfOptions): Blob {
  const labelWidth = Math.max(25, Number(options.labelWidth) || 50);
  const labelHeight = Math.max(15, Number(options.labelHeight) || 30);

  const doc = new jsPDF({
    unit: 'mm',
    format: [labelWidth, labelHeight],
    orientation: labelWidth >= labelHeight ? 'landscape' : 'portrait',
  });

  const labelList: BarcodeLabelData[] =
    options.labels && options.labels.length > 0
      ? options.labels
      : [
          {
            itemName: options.itemName || 'Item',
            barcodeValue: options.barcodeValue || 'ITEM-001',
            secondaryText: options.secondaryText,
            price: options.price,
            copies: options.copies || 1,
          },
        ];

  let isFirstPage = true;

  for (const label of labelList) {
    const count = Math.max(1, label.copies ?? options.copies ?? 1);

    for (let i = 0; i < count; i++) {
      if (!isFirstPage) {
        doc.addPage(
          [labelWidth, labelHeight],
          labelWidth >= labelHeight ? 'landscape' : 'portrait',
        );
      }
      isFirstPage = false;

      // Border around label
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.2);
      doc.roundedRect(1, 1, labelWidth - 2, labelHeight - 2, 1, 1, 'S');

      const centerX = labelWidth / 2;

      // Item Title
      doc.setTextColor(30, 30, 30);
      doc.setFont('helvetica', 'bold');
      const titleFontSize = Math.min(8, Math.max(6, labelWidth / 6));
      doc.setFontSize(titleFontSize);
      const maxTitleLen = Math.floor(labelWidth * 0.55);
      const title =
        label.itemName.length > maxTitleLen
          ? `${label.itemName.slice(0, maxTitleLen - 2)}...`
          : label.itemName;
      const titleY = Math.max(3.5, labelHeight * 0.16);
      doc.text(title, centerX, titleY, { align: 'center' });

      // Barcode position & dimensions
      doc.setFillColor(0, 0, 0);
      const code = (label.barcodeValue || 'ITEM-001').trim() || 'ITEM-001';
      const maxBarcodeWidth = Math.max(18, labelWidth - 8);
      const barHeight = Math.max(6, Math.min(14, labelHeight * 0.35));
      const barcodeY = titleY + 1.8;

      renderNativeCode128(doc, code, labelWidth, maxBarcodeWidth, barHeight, barcodeY);

      // Code Text Under Barcode
      doc.setTextColor(40, 40, 40);
      doc.setFont('helvetica', 'bold');
      const codeFontSize = Math.min(7.5, Math.max(5.5, labelWidth / 6.5));
      doc.setFontSize(codeFontSize);
      let nextY = barcodeY + barHeight + 3.2;
      doc.text(code, centerX, nextY, { align: 'center' });

      // Secondary Text (e.g. Batch / Taka info)
      if (label.secondaryText && nextY + 3.2 < labelHeight - 1.5) {
        nextY += 3.2;
        doc.setFont('helvetica', 'normal');
        const secFontSize = Math.min(6.5, Math.max(5, labelWidth / 7.5));
        doc.setFontSize(secFontSize);
        doc.setTextColor(70, 70, 70);
        doc.text(label.secondaryText, centerX, nextY, { align: 'center' });
      }

      // Price
      if (
        label.price !== undefined &&
        label.price !== null &&
        String(label.price).trim() !== '' &&
        nextY + 3.2 <= labelHeight - 1.2
      ) {
        nextY += 3.4;
        doc.setFont('helvetica', 'bold');
        const priceFontSize = Math.min(7.5, Math.max(5.5, labelWidth / 6.5));
        doc.setFontSize(priceFontSize);
        doc.setTextColor(20, 20, 20);
        doc.text(`MRP: Rs. ${label.price}`, centerX, Math.min(nextY, labelHeight - 2), {
          align: 'center',
        });
      }
    }
  }

  return doc.output('blob');
}
