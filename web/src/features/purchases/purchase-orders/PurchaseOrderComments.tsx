import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchPurchaseOrderComments,
  addPurchaseOrderComment,
  deletePurchaseOrderComment,
} from './purchase-orders.api';
import { format } from 'date-fns';
import { Bold, Italic, Underline, MessageSquare, Trash2 } from 'lucide-react';
import '../vendors/VendorComments.css';

interface PurchaseOrderCommentsProps {
  orgId: string;
  poId: string;
}

export function PurchaseOrderComments({ orgId, poId }: PurchaseOrderCommentsProps) {
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);
  const [activeFormats, setActiveFormats] = useState({
    bold: false,
    italic: false,
    underline: false,
  });

  const checkFormatState = () => {
    setActiveFormats({
      bold: document.queryCommandState('bold'),
      italic: document.queryCommandState('italic'),
      underline: document.queryCommandState('underline'),
    });
  };

  const { data: comments, isLoading } = useQuery({
    queryKey: ['po-comments', orgId, poId],
    queryFn: () => fetchPurchaseOrderComments(orgId, poId),
  });

  const mutation = useMutation({
    mutationFn: (newComment: string) => addPurchaseOrderComment(orgId, poId, newComment),
    onSuccess: () => {
      setComment('');
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
      }
      queryClient.invalidateQueries({ queryKey: ['po-comments', orgId, poId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => deletePurchaseOrderComment(orgId, poId, commentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['po-comments', orgId, poId] });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const stripped = comment.replace(/<[^>]*>?/gm, '').trim();
    if (stripped) {
      mutation.mutate(comment);
    }
  };

  const handleFormat = (command: string) => {
    document.execCommand(command, false, undefined);
    checkFormatState();
  };

  if (isLoading) {
    return <div className="comments-loading">Loading comments...</div>;
  }

  return (
    <div style={{ padding: '24px', maxWidth: '720px' }}>
      <form
        onSubmit={handleSubmit}
        style={{
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          background: '#ffffff',
          marginBottom: '32px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            display: 'flex',
            gap: '4px',
            padding: '8px 12px',
            borderBottom: '1px solid #e2e8f0',
            background: '#f8fafc',
          }}
        >
          <button
            type="button"
            style={{
              background: activeFormats.bold ? '#f0f7fd' : 'transparent',
              border: activeFormats.bold
                ? '1px solid rgba(2, 132, 199, 0.3)'
                : '1px solid transparent',
              padding: '6px',
              cursor: 'pointer',
              color: activeFormats.bold ? '#0284c7' : '#64748b',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.12s ease',
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleFormat('bold')}
          >
            <Bold size={14} />
          </button>
          <button
            type="button"
            style={{
              background: activeFormats.italic ? '#f0f7fd' : 'transparent',
              border: activeFormats.italic
                ? '1px solid rgba(2, 132, 199, 0.3)'
                : '1px solid transparent',
              padding: '6px',
              cursor: 'pointer',
              color: activeFormats.italic ? '#0284c7' : '#64748b',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.12s ease',
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleFormat('italic')}
          >
            <Italic size={14} />
          </button>
          <button
            type="button"
            style={{
              background: activeFormats.underline ? '#f0f7fd' : 'transparent',
              border: activeFormats.underline
                ? '1px solid rgba(2, 132, 199, 0.3)'
                : '1px solid transparent',
              padding: '6px',
              cursor: 'pointer',
              color: activeFormats.underline ? '#0284c7' : '#64748b',
              borderRadius: '4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.12s ease',
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleFormat('underline')}
          >
            <Underline size={14} />
          </button>
        </div>
        <div
          ref={editorRef}
          contentEditable
          onInput={(e) => {
            setComment(e.currentTarget.innerHTML);
            checkFormatState();
          }}
          onKeyUp={checkFormatState}
          onMouseUp={checkFormatState}
          onPaste={(e) => {
            e.preventDefault();
            const text = e.clipboardData.getData('text/plain');
            document.execCommand('insertText', false, text);
          }}
          style={{
            padding: '12px 16px',
            minHeight: '60px',
            outline: 'none',
            overflowY: 'auto',
            fontSize: '13.5px',
            color: '#1e293b',
            lineHeight: 1.5,
          }}
          role="textbox"
        />
        <div
          style={{
            padding: '8px 16px',
            borderTop: '1px solid #f1f5f9',
            background: '#ffffff',
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="submit"
            disabled={!comment.replace(/<[^>]*>?/gm, '').trim() || mutation.isPending}
            style={{
              background:
                !comment.replace(/<[^>]*>?/gm, '').trim() || mutation.isPending
                  ? '#e2e8f0'
                  : 'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
              color:
                !comment.replace(/<[^>]*>?/gm, '').trim() || mutation.isPending
                  ? '#94a3b8'
                  : 'white',
              border: 'none',
              padding: '6px 16px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor:
                !comment.replace(/<[^>]*>?/gm, '').trim() || mutation.isPending
                  ? 'not-allowed'
                  : 'pointer',
              boxShadow:
                !comment.replace(/<[^>]*>?/gm, '').trim() || mutation.isPending
                  ? 'none'
                  : '0 2px 6px rgba(2, 132, 199, 0.25)',
              transition: 'all 0.15s ease',
            }}
          >
            {mutation.isPending ? 'Adding...' : 'Add Comment'}
          </button>
        </div>
      </form>

      <div
        style={{
          fontSize: '12px',
          fontWeight: 600,
          color: '#64748b',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          marginBottom: '20px',
          paddingBottom: '12px',
          borderBottom: '1px solid #e2e8f0',
          letterSpacing: '0.04em',
        }}
      >
        ALL COMMENTS{' '}
        <span
          style={{
            background: '#f0f7fd',
            color: '#0284c7',
            border: '1px solid rgba(2, 132, 199, 0.25)',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: 600,
          }}
        >
          {comments?.length || 0}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        {comments?.map((c) => (
          <div key={c.id} style={{ display: 'flex', gap: '14px', alignItems: 'flex-start' }}>
            <div
              style={{
                width: '34px',
                height: '34px',
                borderRadius: '50%',
                background: '#f0f7fd',
                border: '1px solid rgba(2, 132, 199, 0.2)',
                color: '#0284c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
                marginTop: '2px',
              }}
            >
              <MessageSquare size={15} />
            </div>
            <div style={{ flexGrow: 1, minWidth: 0 }}>
              <div
                style={{
                  marginBottom: '6px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontSize: '12.5px',
                }}
              >
                <span style={{ fontWeight: 600, color: '#0f172a' }}>
                  {c.performedBy || 'System'}
                </span>
                <span style={{ color: '#cbd5e1' }}>•</span>
                <span style={{ color: '#64748b' }}>
                  {format(new Date(c.createdAt), 'dd-MM-yyyy hh:mm a')}
                </span>
              </div>
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #f1f5f9',
                  padding: '12px 16px',
                  borderRadius: '8px',
                  fontSize: '13.5px',
                  color: '#334155',
                  whiteSpace: 'pre-wrap',
                  lineHeight: 1.5,
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  gap: '12px',
                }}
              >
                <div style={{ flex: 1 }} dangerouslySetInnerHTML={{ __html: c.content }} />
                <button
                  type="button"
                  title="Delete comment"
                  onClick={() => {
                    if (window.confirm('Are you sure you want to delete this comment?')) {
                      deleteMutation.mutate(c.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'color 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {comments?.length === 0 && (
          <div style={{ textAlign: 'center', padding: '32px', color: '#94a3b8', fontSize: '13px' }}>
            No comments yet.
          </div>
        )}
      </div>
    </div>
  );
}
