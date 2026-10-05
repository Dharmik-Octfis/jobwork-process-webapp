import { useState, useRef, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
  content: string | ReactNode;
  children: ReactNode;
  delay?: number;
}

export function Tooltip({ content, children, delay = 200 }: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const containerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setPosition({
          top: rect.bottom + window.scrollY + 8,
          left: rect.left + window.scrollX,
        });
      }
      setIsVisible(true);
    }, delay);
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setIsVisible(false);
  };

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div
      ref={containerRef}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ display: 'inline-flex', maxWidth: '100%', overflow: 'hidden' }}
    >
      {children}
      {isVisible && content &&
        createPortal(
          <div
            style={{
              position: 'absolute',
              top: position.top,
              left: position.left,
              backgroundColor: '#1e293b',
              color: '#fff',
              padding: '6px 12px',
              borderRadius: '4px',
              fontSize: '12px',
              zIndex: 9999,
              maxWidth: '300px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
              pointerEvents: 'none',
              whiteSpace: 'pre-wrap',
              wordWrap: 'break-word',
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </div>
  );
}
