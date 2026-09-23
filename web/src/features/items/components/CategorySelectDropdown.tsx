import { useState } from 'react';
import { ChevronDown, Search, Settings, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { fetchItemCategories } from '../../inventory/item-categories/item-categories.api';
import type { ItemCategory } from '../../inventory/item-categories/item-categories.api';
import { ManageCategoriesModal } from './ManageCategoriesModal';
import { useCombobox } from 'downshift';

interface CategorySelectDropdownProps {
  value: string | null;
  onChange: (value: string) => void;
  error?: boolean;
  hideManageButton?: boolean;
}

export function CategorySelectDropdown({
  value,
  onChange,
  error,
  hideManageButton,
}: CategorySelectDropdownProps) {
  const { orgId } = useParams<{ orgId: string }>();
  const [search, setSearch] = useState('');
  const [isManageModalOpen, setIsManageModalOpen] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['item-categories', orgId],
    queryFn: () => fetchItemCategories(orgId!),
    enabled: Boolean(orgId),
  });

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

  const flattenCategories = (
    cats: ItemCategory[],
    level = 0,
  ): { cat: ItemCategory; level: number }[] => {
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

  const {
    isOpen,
    getToggleButtonProps,
    getMenuProps,
    getInputProps,
    highlightedIndex,
    getItemProps,
    closeMenu,
  } = useCombobox({
    items: filtered,
    itemToString: (item) => (item ? item.cat.name : ''),
    inputValue: search,
    onInputValueChange: ({ inputValue, type }) => {
      setSearch(inputValue || '');
      if (type === useCombobox.stateChangeTypes.InputChange && inputValue === '') {
        onChange('');
      }
    },
    onSelectedItemChange: ({ selectedItem }) => {
      if (selectedItem) {
        onChange(selectedItem.cat.name);
        setSearch('');
      } else {
        onChange('');
        setSearch('');
      }
    },
    stateReducer: (_state, actionAndChanges) => {
      const { type, changes } = actionAndChanges;
      switch (type) {
        case useCombobox.stateChangeTypes.ItemClick:
        case useCombobox.stateChangeTypes.InputKeyDownEnter:
          return { ...changes, inputValue: '' };
        default:
          return changes;
      }
    },
  });

  return (
    <>
      <div style={{ position: 'relative', width: '100%' }}>
        <button
          type="button"
          {...getToggleButtonProps({
            style: {
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              padding: '8px 12px',
              borderRadius: '4px',
              border: error
                ? '1px solid #ef4444'
                : isOpen
                  ? '1px solid #0284c7'
                  : '1px solid #d1d5db',
              boxShadow: isOpen ? '0 0 0 1px #0284c7' : 'none',
              background: '#fff',
              cursor: 'pointer',
              fontSize: 13,
              minHeight: '36px',
              textAlign: 'left',
              transition: 'all 0.15s ease',
            },
          })}
        >
          <span style={{ color: value ? '#0f172a' : '#6b7280' }}>
            {value || 'Select a category'}
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {value && (
              <div
                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px' }}
                onClick={(e) => {
                  e.stopPropagation();
                  onChange('');
                  setSearch('');
                }}
              >
                <X size={14} color="#94a3b8" />
              </div>
            )}
            <ChevronDown
              size={14}
              color={isOpen ? '#0284c7' : '#6b7280'}
              style={{
                transform: isOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform 0.2s',
              }}
            />
          </div>
        </button>

        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: '#fff',
            border: isOpen ? '1px solid #e2e8f0' : 'none',
            borderRadius: '6px',
            boxShadow: isOpen
              ? '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'
              : 'none',
            zIndex: 50,
            display: isOpen ? 'flex' : 'none',
            flexDirection: 'column',
            maxHeight: '300px',
          }}
        >
          {isOpen && (
            <>
              <div style={{ padding: '8px', borderBottom: '1px solid #e2e8f0' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    padding: '6px 10px',
                    gap: 8,
                    transition: 'all 0.15s ease',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = '#0284c7';
                    e.currentTarget.style.backgroundColor = '#ffffff';
                    e.currentTarget.style.boxShadow = '0 0 0 2px rgba(2, 132, 199, 0.15)';
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = '#cbd5e1';
                    e.currentTarget.style.backgroundColor = '#f8fafc';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                >
                  <Search size={14} color="#64748b" style={{ flexShrink: 0 }} />
                  <input
                    {...getInputProps({
                      className: 'no-global-focus',
                      placeholder: 'Search category...',
                      autoFocus: true,
                      style: {
                        border: 'none',
                        background: 'transparent',
                        outline: 'none',
                        fontSize: 13,
                        color: '#0f172a',
                        width: '100%',
                        padding: 0,
                      },
                    })}
                  />
                </div>
              </div>

              <div {...getMenuProps()} style={{ flex: 1, overflowY: 'auto' }}>
                {filtered.length > 0 ? (
                  filtered.map((item, index) => {
                    const { cat, level } = item;
                    const isSelected = value === cat.name;
                    const isHighlighted = highlightedIndex === index;
                    return (
                      <div
                        {...getItemProps({ item, index })}
                        key={cat.id}
                        style={{
                          padding: '8px 12px',
                          paddingLeft: `${12 + level * 16}px`,
                          fontSize: 13,
                          color: isSelected ? '#0284c7' : '#334155',
                          fontWeight: isSelected ? 500 : 400,
                          background: isHighlighted
                            ? '#f8fafc'
                            : isSelected
                              ? '#f0f7fd'
                              : 'transparent',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                        }}
                      >
                        {level > 0 && (
                          <span style={{ marginRight: 6, color: '#94a3b8', fontSize: 10 }}>•</span>
                        )}
                        {cat.name}
                      </div>
                    );
                  })
                ) : (
                  <div
                    style={{ padding: '12px', textAlign: 'center', fontSize: 12, color: '#94a3b8' }}
                  >
                    No categories found.
                  </div>
                )}
              </div>

              {!hideManageButton && (
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
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      closeMenu();
                      setIsManageModalOpen(true);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      width: '100%',
                      padding: '8px',
                      border: 'none',
                      borderRadius: '4px',
                      background: 'transparent',
                      color: '#0284c7',
                      fontSize: 13,
                      fontWeight: 500,
                      cursor: 'pointer',
                      textAlign: 'left',
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = '#f0f7fd';
                      e.currentTarget.style.color = '#0369a1';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = '#0284c7';
                    }}
                  >
                    <Settings size={14} />
                    Manage Categories
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {isManageModalOpen && (
        <ManageCategoriesModal
          categories={categories}
          onClose={() => setIsManageModalOpen(false)}
          onSelectCategory={(category) => {
            onChange(category.name);
            setIsManageModalOpen(false);
          }}
        />
      )}
    </>
  );
}
