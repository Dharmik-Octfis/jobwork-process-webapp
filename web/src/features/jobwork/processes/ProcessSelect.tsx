import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Select } from '../../../components/ui/Select';
import { createProcess, fetchProcesses } from './processes.api';
import type { Process } from './processes.schemas';

interface Props {
  value: string | null;
  onChange: (processId: string, process: Process) => void;
  disabled?: boolean;
  ariaLabel?: string;
  minWidth?: number | string;
  /** Forwarded to `Select` — required wherever this sits inside a `Modal`, or the
   * menu is clipped by the dialog's scrolling body. The create row is unaffected:
   * it renders below the select, in the page, not inside the menu. */
  portal?: boolean;
}

/**
 * Pick a process, or create one without leaving the form.
 *
 * 🔴 The inline create is the point of this component, not a flourish. A route
 * step cannot be written without naming its process, so a master that has to be
 * populated first becomes a gate: someone building a route hits an operation
 * nobody has entered yet, leaves to go create it, and loses their place. Typing
 * the name here costs one click and keeps them where they are.
 *
 * WHERE THE CREATE ROW LIVES, AND WHY IT IS NOT IN THE MENU
 *
 * The dropdown's footer holds a plain `<button>` (the shape `CreateItemPage`
 * already uses for "New Unit Group"), and that button reveals a text input
 * BELOW the select, in the page's own tab order. Putting the input inside the
 * menu would look tidier and be unusable: the menu is a downshift listbox, focus
 * stays on the trigger while it is open, and keystrokes are the listbox's — so
 * the field would be mouse-only, which `tsc -b` and a screenshot both report as
 * perfect. Outside the menu it is simply an input, reachable with Tab, submitting
 * on Enter, closing on Esc.
 *
 * It creates a MINIMAL process — name only, every flag at its default. The flags
 * decide what the Issue and Receive dialogs may offer, and guessing them from a
 * name typed in a hurry is worse than leaving them to be set on the process's own
 * screen. The defaults are the conservative answers: same item back, bulk receipt
 * only, batches may be mixed.
 *
 * Nothing in Sprint 1 uses this — routes and job orders, which consume it, ship
 * in Sprint 2.
 */
export function ProcessSelect({
  value,
  onChange,
  disabled,
  ariaLabel,
  minWidth = 260,
  portal,
}: Props) {
  const { orgId } = useParams<{ orgId: string }>();
  const queryClient = useQueryClient();
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const triggerRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    // Every process the org has. There is no active/inactive split any more — an
    // operation you have stopped running is deleted, and soft-deleted rows are
    // already excluded server-side.
    queryKey: ['processes', orgId, '', 'all', 1, 500],
    queryFn: () => fetchProcesses(orgId!, { filter: 'all', perPage: 500 }),
    enabled: Boolean(orgId),
  });

  const processes = data?.results ?? [];

  const createMutation = useMutation({
    mutationFn: (name: string) => createProcess(orgId!, { name }),
    onSuccess: (created) => {
      queryClient.invalidateQueries({ queryKey: ['processes', orgId] });
      setNewName('');
      setIsCreating(false);
      onChange(created.id, created);
      // Focus goes back where it came from, not to the top of the document.
      triggerRef.current?.querySelector('button')?.focus();
    },
    onError: (error: { response?: { data?: { message?: string } } }) => {
      alert(error.response?.data?.message || 'Could not create that process');
    },
  });

  const trimmed = newName.trim();
  const isDuplicate = processes.some((p) => p.name.toLowerCase() === trimmed.toLowerCase());
  const canCreate = trimmed.length > 0 && !isDuplicate && !createMutation.isPending;

  const cancelCreate = () => {
    setIsCreating(false);
    setNewName('');
    triggerRef.current?.querySelector('button')?.focus();
  };

  return (
    <div style={{ display: 'inline-block', minWidth }}>
      <div ref={triggerRef}>
        <Select
          value={value ?? ''}
          onChange={(id) => {
            const picked = processes.find((p) => p.id === id);
            if (picked) onChange(id, picked);
          }}
          options={processes.map((p) => ({ value: p.id, label: p.name }))}
          placeholder="Select a process…"
          disabled={disabled}
          ariaLabel={ariaLabel ?? 'Process'}
          minWidth={minWidth}
          portal={portal}
          actionItem={
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsCreating(true);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                width: '100%',
                padding: '8px 12px',
                color: '#0062ff',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                textAlign: 'left',
              }}
            >
              <Plus size={14} /> New Process
            </button>
          }
        />
      </div>

      {isCreating && (
        <div style={{ display: 'flex', gap: 6, marginTop: 6, alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  // The select sits inside a form; Enter here must create a
                  // process, not submit the form behind it.
                  e.preventDefault();
                  if (canCreate) createMutation.mutate(trimmed);
                }
                if (e.key === 'Escape') cancelCreate();
              }}
              placeholder="New process name"
              aria-label="New process name"
              autoFocus
              style={{
                width: '100%',
                padding: '5px 8px',
                fontSize: 13,
                border: '1px solid #d1d5db',
                borderRadius: 4,
                minHeight: 30,
              }}
            />
            {isDuplicate && (
              <span style={{ display: 'block', marginTop: 4, fontSize: 11, color: '#e54d4d' }}>
                A process with that name already exists.
              </span>
            )}
          </div>
          <button
            type="button"
            disabled={!canCreate}
            onClick={() => createMutation.mutate(trimmed)}
            style={{
              padding: '5px 10px',
              fontSize: 12,
              border: '1px solid #d1d5db',
              borderRadius: 4,
              background: canCreate ? '#fff' : '#f1f5f9',
              color: canCreate ? '#0062ff' : '#94a3b8',
              cursor: canCreate ? 'pointer' : 'not-allowed',
              whiteSpace: 'nowrap',
              minHeight: 30,
            }}
          >
            {createMutation.isPending ? 'Creating…' : 'Create'}
          </button>
          <button
            type="button"
            onClick={cancelCreate}
            style={{
              padding: '5px 10px',
              fontSize: 12,
              border: '1px solid #d1d5db',
              borderRadius: 4,
              background: '#fff',
              color: '#64748b',
              cursor: 'pointer',
              minHeight: 30,
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
