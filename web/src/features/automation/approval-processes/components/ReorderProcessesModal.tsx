import { useState } from 'react';
import { ArrowUp, ArrowDown, GripVertical, Loader2 } from 'lucide-react';
import { Modal } from '../../../../components/ui/Modal';
import type { ApprovalProcessListItem } from '../types/approvalProcess.types';
import { useReorderApprovalProcesses } from '../api/approvalProcess.api';
import './ReorderProcessesModal.css';

interface ReorderProcessesModalProps {
  orgId: string;
  processes: ApprovalProcessListItem[];
  moduleName?: string;
  onClose: () => void;
}

export function ReorderProcessesModal({
  orgId,
  processes,
  moduleName,
  onClose,
}: ReorderProcessesModalProps) {
  const safeProcesses = Array.isArray(processes)
    ? processes
    : Array.isArray((processes as any)?.items)
    ? (processes as any).items
    : [];
  const [items, setItems] = useState<ApprovalProcessListItem[]>(safeProcesses);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const reorderMutation = useReorderApprovalProcesses(orgId);

  const moveUp = (idx: number) => {
    if (idx <= 0) return;
    const copy = [...items];
    const temp = copy[idx - 1];
    copy[idx - 1] = copy[idx];
    copy[idx] = temp;
    setItems(copy);
  };

  const moveDown = (idx: number) => {
    if (idx >= items.length - 1) return;
    const copy = [...items];
    const temp = copy[idx + 1];
    copy[idx + 1] = copy[idx];
    copy[idx] = temp;
    setItems(copy);
  };

  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
    // Transparent ghost drag support
    if (e.dataTransfer.setData) {
      e.dataTransfer.setData('text/plain', String(index));
    }
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dragOverIndex !== index) {
      setDragOverIndex(index);
    }
  };

  const handleDragLeave = () => {
    setDragOverIndex(null);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) {
      setDraggedIndex(null);
      setDragOverIndex(null);
      return;
    }

    const updated = [...items];
    const [movedItem] = updated.splice(draggedIndex, 1);
    updated.splice(targetIndex, 0, movedItem);

    setItems(updated);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleSave = async () => {
    const processIds = items.map((p) => p.id);
    await reorderMutation.mutateAsync(processIds);
    onClose();
  };

  const footer = (
    <div className="ap-reorder-footer-actions">
      <button
        type="button"
        className="ap-button ap-button-secondary"
        onClick={onClose}
        disabled={reorderMutation.isPending}
      >
        Cancel
      </button>
      <button
        type="button"
        className="ap-button ap-button-primary"
        onClick={handleSave}
        disabled={reorderMutation.isPending}
      >
        {reorderMutation.isPending ? (
          <>
            <Loader2 size={15} className="ap-spinner-icon" />
            <span>Saving...</span>
          </>
        ) : (
          'Save Order'
        )}
      </button>
    </div>
  );

  const subtitle = moduleName
    ? `Processes for "${moduleName}" are evaluated from top to bottom. Drag & drop or use arrows to adjust priority.`
    : 'Processes are evaluated from top to bottom. Drag & drop or use arrows to adjust priority.';

  return (
    <Modal
      isOpen={true}
      title="Reorder Approval Processes"
      subtitle={subtitle}
      onClose={onClose}
      width={540}
      footer={footer}
    >
      <div className="ap-reorder-list">
        {items.map((process, idx) => {
          const isDragging = draggedIndex === idx;
          const isDragOver = dragOverIndex === idx && draggedIndex !== idx;

          return (
            <div
              key={process.id}
              className={`ap-reorder-item ${isDragging ? 'is-dragging' : ''} ${isDragOver ? 'is-drag-over' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, idx)}
              onDragOver={(e) => handleDragOver(e, idx)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, idx)}
              onDragEnd={handleDragEnd}
            >
              <div className="ap-reorder-handle" title="Drag to reorder">
                <GripVertical size={16} />
              </div>
              <div className="ap-reorder-order">{idx + 1}</div>
              <div className="ap-reorder-details">
                <span className="ap-reorder-name">{process.name}</span>
                <span className="ap-reorder-module">{process.moduleName}</span>
              </div>
              <div className="ap-reorder-buttons">
                <button
                  type="button"
                  className="ap-reorder-btn"
                  disabled={idx === 0}
                  onClick={() => moveUp(idx)}
                  aria-label="Move Up"
                  title="Move Up"
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  className="ap-reorder-btn"
                  disabled={idx === items.length - 1}
                  onClick={() => moveDown(idx)}
                  aria-label="Move Down"
                  title="Move Down"
                >
                  <ArrowDown size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
