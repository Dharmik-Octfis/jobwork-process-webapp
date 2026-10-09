import React from 'react';
import { Modal } from '../../../components/ui/Modal';
import { Button } from '../../../components/ui/Button';

interface BarcodePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  pdfUrl: string | null;
  onPrint: () => void;
}

export const BarcodePreviewModal: React.FC<BarcodePreviewModalProps> = ({
  isOpen,
  onClose,
  pdfUrl,
  onPrint,
}) => {
  const handlePrint = () => {
    onPrint();
    const iframe = document.getElementById('barcode-pdf-iframe') as HTMLIFrameElement;
    if (iframe && iframe.contentWindow) {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    }
  };

  const footer = (
    <>
      <Button
        variant="primary"
        onClick={handlePrint}
        style={{ backgroundColor: '#059669', borderColor: '#059669', color: 'white' }}
      >
        Print
      </Button>
      <Button variant="secondary" onClick={onClose}>
        Close
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Preview"
      width={900}
      position="center"
      footer={footer}
    >
      <div
        style={{
          height: '65vh',
          backgroundColor: '#f3f4f6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '-16px -20px',
          width: 'calc(100% + 40px)',
        }}
      >
        {pdfUrl ? (
          <iframe
            id="barcode-pdf-iframe"
            src={`${pdfUrl}#toolbar=1&navpanes=0&scrollbar=0`}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title="Barcode PDF Preview"
          />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              color: '#6b7280',
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                border: '2px solid #e5e7eb',
                borderTopColor: '#374151',
                borderRadius: '50%',
                animation: 'spin 1s linear infinite',
                marginBottom: 16,
              }}
            />
            Generating Barcode PDF...
          </div>
        )}
      </div>
    </Modal>
  );
};
