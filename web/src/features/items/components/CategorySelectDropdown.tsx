import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Search,Settings } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { fetchItemCategories } from '../../inventory/item-categories/item-categories.api';
import type { ItemCategory } from '../../inventory/item-categories/item-categories.api';
import { ManageCategoriesModal } from './ManageCategoriesModal';

interface CategorySelectDropdownProps {
  value: string | null;
  onChange: (value: string) => void;
  error?: boolean;
}

export function CategorySelectDropdown({ value, onChange, error }: CategorySelectDropdownProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['item-categories', orgId],
    queryFn: () => fetchItemCategories(orgId!),
    enabled: Boolean(orgId),
  });

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Build hierarchy for rendering
  const rootCategories = categories.filter((c) => !c.parentId);
  const childrenMap = new Map<string, ItemCategory[]>();
  categories.forEach((c) => {
    if (c.parentId) {
      const children = childrenMap.get(c.parentId) || [];
      children.push(c);
      childrenMap.set(c.parentId, children);
    }
  });

  const flattenCategories = (cats: ItemCategory[], level = 0): { cat: ItemCategory; level: number }[] => {
    let result: { cat: ItemCategory; level: number }[] = [];
    for (const cat of cats) {
      result.push({ cat, level });
      const children = childrenMap.get(cat.id) || [];
      result = result.concat(flattenCategories(children, level + 1));
    }
    return result;
  };

  const allFlattened = flattenCategories(rootCategories);
  const filtered = search
    ? allFlattened.filter((item) => item.cat.name.toLowerCase().includes(search.toLowerCase()))
    : allFlattened;

  const handleSelect = (categoryName: string) => {
    onChange(categoryName);
    setIsOpen(false);
  };

  return (
    <>
      <div ref={containerRef} style={{ position: 'relative', width: '100%' }}>
        <div
          onClick={() => setIsOpen(!isOpen)}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '6px 10px',
            borderRadius: '4px',
            border: error ? '1px solid #ef4444' : '1px solid #d1d5db',
            background: '#fff',
            cursor: 'pointer',
            fontSize: 12,
            minHeight: '30px',
          }}
        >
          <span style={{ color: value ? '#000' : '#6b7280' }}>
            {value || 'Select a category'}
          </span>
          <ChevronDown size={14} color="#6b7280" />
        </div>

        {isOpen && (
          <div
            style={{
              position: 'absolute',
              top: '100%',
              left: 0,
              right: 0,
              marginTop: 4,
              background: '#fff',
              border: '1px solid #e2e8f0',
              borderRadius: '6px',
              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
              zIndex: 50,
              display: 'flex',
              flexDirection: 'column',
              maxHeight: '300px',
            }}
          >
            <div style={{ padding: '8px', borderBottom: '1px solid #e2e8f0' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: '4px',
                  padding: '4px 8px',
                }}
              >
                <Search size={14} color="#94a3b8" />
                <input
                  type="text"
                  placeholder="Search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: 12,
                    marginLeft: 6,
                    width: '100%',
                  }}
                  autoFocus
                />
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              {filtered.length > 0 ? (
                filtered.map(({ cat, level }) => (
                  <div
                    key={cat.id}
                    onClick={() => handleSelect(cat.name)}
                    style={{
                      padding: '8px 12px',
                      paddingLeft: `${12 + level * 16}px`,
                      fontSize: 13,
                      color: value === cat.name ? '#2563eb' : '#334155',
                      background: value === cat.name ? '#eff6ff' : 'transparent',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                    onMouseEnter={(e) => {
                      if (value !== cat.name) e.currentTarget.style.backgroundColor = '#f8fafc';
                    }}
                    onMouseLeave={(e) => {
                      if (value !== cat.name) e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                  >
                    {level > 0 && (
                      <span style={{ marginRight: 6, color: '#94a3b8', fontSize: 10 }}>•</span>
                    )}
                    {cat.name}
                  </div>
                ))
              ) : (
                <div style={{ padding: '12px', textAlign: 'center', fontSize: 12, color: '#94a3b8' }}>
                  No categories found.
                </div>
              )}
            </div>

            <div
              style={{
                borderTop: '1px solid #e2e8f0',
                padding: '4px',
                background: '#f8fafc',
                borderBottomLeftRadius: '6px',
                borderBottomRightRadius: '6px',
              }}
            >
              <button
                onClick={() => {
                  setIsOpen(false);
                  setIsManageModalOpen(true);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  width: '100%',
                  padding: '8px',
                  border: 'none',
                  background: 'transparent',
                  color: '#2563eb',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <Settings size={14} />
                Manage Categories
              </button>
            </div>
          </div>
        )}
      </div>

      {isManageModalOpen && (
        <ManageCategoriesModal
          categories={categories}
          onClose={() => setIsManageModalOpen(false)}
          onSelectCategory={(category) => {
            handleSelect(category.name);
            setIsManageModalOpen(false);
          }}
        />
      )}
    </>
  );
}
