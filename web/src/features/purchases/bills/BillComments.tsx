import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { fetchBillComments, addBillComment, deleteBillComment } from './bills.api';
import { format } from 'date-fns';
import { Bold, Italic, Underline, MessageSquare, Trash2 } from 'lucide-react';
import '../vendors/VendorComments.css';

interface BillCommentsProps {
  orgId: string;
  poId: string;
}

export function BillComments({ orgId, poId }: BillCommentsProps) {
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
    queryFn: () => fetchBillComments(orgId, poId),
  });

  const mutation = useMutation({
    mutationFn: (newComment: string) => addBillComment(orgId, poId, newComment),
    onSuccess: () => {
      setComment('');
      if (editorRef.current) {
        editorRef.current.innerHTML = '';
      }
      queryClient.invalidateQueries({ queryKey: ['po-comments', orgId, poId] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (commentId: string) => deleteBillComment(orgId, poId, commentId),
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
    <div className="vendor-comments-container">
      <form onSubmit={handleSubmit} className="comment-editor">
        <div className="comment-toolbar">
          <button
            type="button"
            className={`toolbar-btn ${activeFormats.bold ? 'active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleFormat('bold')}
          >
            <Bold size={14} />
          </button>
          <button
            type="button"
            className={`toolbar-btn ${activeFormats.italic ? 'active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleFormat('italic')}
          >
            <Italic size={14} />
          </button>
          <button
            type="button"
            className={`toolbar-btn ${activeFormats.underline ? 'active' : ''}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleFormat('underline')}
          >
            <Underline size={14} />
          </button>
        </div>
        <div
          ref={editorRef}
          className="comment-textarea"
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
          style={{ minHeight: '44px', outline: 'none', overflowY: 'auto' }}
          role="textbox"
        />
        <div className="comment-actions">
          <button
            type="submit"
            className="add-comment-btn"
            disabled={!comment.replace(/<[^>]*>?/gm, '').trim() || mutation.isPending}
          >
            {mutation.isPending ? 'Adding...' : 'Add Comment'}
          </button>
        </div>
      </form>

      <div className="comments-list-header">
        ALL COMMENTS <span className="comments-count">{comments?.length || 0}</span>
      </div>

      <div className="comments-list">
        {comments?.map((c) => (
          <div key={c.id} className="comment-item">
            <div className="comment-avatar">
              <MessageSquare size={14} />
            </div>
            <div className="comment-content-wrapper">
              <div className="comment-header">
                <span className="comment-author">{c.performedBy || 'System'}</span>
                <span className="comment-bullet">•</span>
                <span className="comment-date">
                  {format(new Date(c.createdAt), 'dd-MM-yyyy hh:mm a')}
                </span>
              </div>
              <div className="comment-body">
                <div className="comment-text" dangerouslySetInnerHTML={{ __html: c.content }} />
                <button
                  type="button"
                  className="comment-delete-btn"
                  title="Delete comment"
                  onClick={() => {
                    if (window.confirm('Are you sure you want to delete this comment?')) {
                      deleteMutation.mutate(c.id);
                    }
                  }}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        ))}
        {comments?.length === 0 && <div className="comments-empty">No comments yet.</div>}
      </div>
    </div>
  );
}
