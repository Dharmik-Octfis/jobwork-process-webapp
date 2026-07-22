import { useState, useRef,useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Plus, Download, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { itemsApi } from '../items.api';
import type { Item, ItemFormData } from '../items.schemas';

// --- Image Viewer Modal ---
function ImageViewerModal({
  isOpen,
  onClose,
  orgId,
  itemId,
  item,
  initialImageKey
}: {
  isOpen: boolean;
  onClose: () => void;
  orgId: string;
  itemId: string;
  item: Item;
  initialImageKey: string | null;
}) {
  const queryClient = useQueryClient();
  const [activeImageKey, setActiveImageKey] = useState<string | null>(initialImageKey);

  const allImages = useMemo(() => {
    const imgs: string[] = [];
    if (item.frontImage) imgs.push(item.frontImage);
    if (item.rearImage) imgs.push(item.rearImage);
    if (item.images) imgs.push(...item.images);
    return Array.from(new Set(imgs));
  }, [item]);

  const activeIndex = allImages.indexOf(activeImageKey || '');

  const handlePrevious = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeIndex > 0) setActiveImageKey(allImages[activeIndex - 1]);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (activeIndex < allImages.length - 1) setActiveImageKey(allImages[activeIndex + 1]);
  };

  const { data: url } = useQuery({
    queryKey: ['signedUrl', orgId, itemId, activeImageKey],
    queryFn: () => itemsApi.getSignedUrl(orgId, itemId, activeImageKey!),
    enabled: Boolean(isOpen && activeImageKey),
  });

  const updateItemMutation = useMutation({
    mutationFn: (data: Partial<ItemFormData>) => itemsApi.updateItem({ orgId, id: itemId, data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item', orgId, itemId] });
    }
  });

  const handleMarkAsFront = () => {
    if (!activeImageKey) return;
    if (activeImageKey === item.frontImage) return;

    const newImages = [...(item.images || [])];
    const index = newImages.indexOf(activeImageKey);
    if (index !== -1) {
      newImages.splice(index, 1);
    }
    if (item.frontImage) {
      newImages.push(item.frontImage);
    }

    updateItemMutation.mutate({
      frontImage: activeImageKey,
      images: newImages
    });
  };

  const handleDownload = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!url) return;
    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `item_image_${activeImageKey}`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (error) {
      console.error('Download failed', error);
      window.open(url, '_blank');
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        background: 'rgba(0, 0, 0, 0.85)',
        backdropFilter: 'blur(4px)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px'
      }}
    >
      <div style={{ position: 'absolute', top: '24px', right: '24px' }}>
        <button
          onClick={onClose}
          style={{ background: '#000', border: 'none', borderRadius: '50%', width: '44px', height: '44px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'white', transition: 'background 0.2s' }}
          onMouseEnter={(e) => e.currentTarget.style.background = '#333'}
          onMouseLeave={(e) => e.currentTarget.style.background = '#000'}
        >
          <X size={24} />
        </button>
      </div>

      <div style={{ background: 'white', borderRadius: '16px', maxWidth: '90vw', maxHeight: '95vh', display: 'flex', flexDirection: 'column', position: 'relative', overflow: 'hidden', boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)' }}>

        {/* Main Image Area */}
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>

          {/* Nav Arrows */}
          {activeIndex > 0 && (
            <button onClick={handlePrevious} style={{ position: 'absolute', left: '16px', background: '#000', color: '#fff', border: 'none', borderRadius: '50%', width: '40px', height: '40px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 10, transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = '#333'} onMouseLeave={(e) => e.currentTarget.style.background = '#000'}>
              <ChevronLeft size={24} />
            </button>
          )}

          {url && (
            <img src={url} alt="Viewer" style={{ maxWidth: '800px', maxHeight: '65vh', objectFit: 'contain', display: 'block', borderRadius: '8px' }} />
          )}

          {activeIndex >= 0 && activeIndex < allImages.length - 1 && (
            <button onClick={handleNext} style={{ position: 'absolute', right: '24px', background: '#000', color: '#fff', border: 'none', borderRadius: '50%', width: '48px', height: '48px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', zIndex: 10, transition: 'background 0.2s' }} onMouseEnter={(e) => e.currentTarget.style.background = '#333'} onMouseLeave={(e) => e.currentTarget.style.background = '#000'}>
              <ChevronRight size={24} />
            </button>
          )}
        </div>

        {/* Thumbnails */}
        <div style={{ padding: '0 24px 16px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
          {allImages.map((img, idx) => (
            <div key={idx} onClick={() => setActiveImageKey(img)} style={{ width: '48px', height: '48px', border: activeImageKey === img ? '2px solid #3b82f6' : '1px solid #eef0f3', borderRadius: '8px', padding: activeImageKey === img ? '2px' : '0', cursor: 'pointer', overflow: 'hidden' }}>
              <ImageThumbnail orgId={orgId} itemId={itemId} imageKey={img} />
            </div>
          ))}
        </div>

        {/* Bottom Bar */}
        <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #eef0f3' }}>
          <button onClick={handleMarkAsFront} disabled={updateItemMutation.isPending} style={{ background: 'none', border: 'none', color: '#3b82f6', fontSize: '14px', fontWeight: 500, cursor: updateItemMutation.isPending ? 'not-allowed' : 'pointer', padding: '8px 12px' }}>
            Mark as Front
          </button>

          <button
            onClick={handleDownload}
            style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#3b82f6', background: 'none', border: 'none', fontSize: '14px', fontWeight: 500, padding: '8px 12px', cursor: 'pointer' }}
          >
            <Download size={16} /> Download
          </button>

          <button style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: '8px 12px' }}>
            <Trash2 size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

// --- Thumbnail Component ---
function ImageThumbnail({
  orgId,
  itemId,
  imageKey,
  onDelete,
  onClick
}: {
  orgId: string;
  itemId: string;
  imageKey: string;
  onDelete?: () => void;
  onClick?: (url: string) => void;
}) {
  const { data: url, isLoading } = useQuery({
    queryKey: ['signedUrl', orgId, itemId, imageKey],
    queryFn: () => itemsApi.getSignedUrl(orgId, itemId, imageKey),
    enabled: Boolean(imageKey),
    staleTime: 1000 * 60 * 30, // 30 minutes
  });

  if (isLoading) {
    return (
      <div style={{ width: '100%', height: '100%', background: '#e2e8f0', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', color: '#64748b' }}>
        Loading...
      </div>
    );
  }

  if (!url) return null;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', border: '1px solid #eef0f3', borderRadius: '8px', overflow: 'hidden', background: '#fff', cursor: 'pointer' }} onClick={() => onClick?.(url)}>
      <img src={url} alt="Item" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          style={{ position: 'absolute', top: '8px', right: '8px', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', padding: '4px' }}
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}

// --- Main Gallery Component ---
export function ItemImageGallery({ orgId, itemId, item }: { orgId: string; itemId: string; item: Item }) {
  const queryClient = useQueryClient();
  const frontImageRef = useRef<HTMLInputElement>(null);
  const rearImageRef = useRef<HTMLInputElement>(null);
  const otherImagesRef = useRef<HTMLInputElement>(null);

  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerImageKey, setViewerImageKey] = useState<string | null>(null);

  const openViewer = (imageKey: string) => {
    setViewerImageKey(imageKey);
    setViewerOpen(true);
  };

  const uploadImagesMutation = useMutation({
    mutationFn: (formData: FormData) => itemsApi.uploadImages(orgId, itemId, formData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item', orgId, itemId] });
      queryClient.invalidateQueries({ queryKey: ['items', orgId] });
      queryClient.invalidateQueries({ queryKey: ['itemActivities', orgId, itemId] });
    },
    onError: (error) => {
      console.error('Failed to upload image:', error);
      alert('Failed to upload image.');
    },
  });

  const handleFrontImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const formData = new FormData();
      formData.append('frontImage', e.target.files[0]);
      uploadImagesMutation.mutate(formData);
    }
  };

  const handleRearImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const formData = new FormData();
      formData.append('rearImage', e.target.files[0]);
      uploadImagesMutation.mutate(formData);
    }
  };

  const handleOtherImagesUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const formData = new FormData();
      Array.from(e.target.files).forEach(file => {
        formData.append('images', file);
      });
      uploadImagesMutation.mutate(formData);
    }
  };

  return (
    <>
      <div style={{ border: '1px solid #eef0f3', borderRadius: '12px', padding: '16px', display: 'flex', gap: '16px', background: '#fff' }}>
        {/* Left Column (Front & Rear) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', width: '140px', flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 13, marginBottom: 8, color: '#1e293b', fontWeight: 500 }}>Front View</div>
            <input type="file" ref={frontImageRef} onChange={handleFrontImageUpload} style={{ display: 'none' }} accept="image/*" />
            <div style={{ height: '90px' }}>
              {item.frontImage ? (
                <ImageThumbnail
                  orgId={orgId}
                  itemId={itemId}
                  imageKey={item.frontImage}
                  onClick={() => openViewer(item.frontImage!)}
                />
              ) : (
                <button type="button" onClick={() => frontImageRef.current?.click()} disabled={uploadImagesMutation.isPending} style={{ width: '100%', height: '100%', border: '1px dashed #cbd5e1', borderRadius: '8px', background: '#ffffff', color: '#0062ff', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: uploadImagesMutation.isPending ? 'not-allowed' : 'pointer' }}>
                  <span style={{ fontSize: 16 }}>↑</span>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>Upload</span>
                </button>
              )}
            </div>
          </div>

          <div>
            <div style={{ fontSize: 13, marginBottom: 8, color: '#1e293b', fontWeight: 500 }}>Rear View</div>
            <input type="file" ref={rearImageRef} onChange={handleRearImageUpload} style={{ display: 'none' }} accept="image/*" />
            <div style={{ height: '90px' }}>
              {item.rearImage ? (
                <ImageThumbnail
                  orgId={orgId}
                  itemId={itemId}
                  imageKey={item.rearImage}
                  onClick={() => openViewer(item.rearImage!)}
                />
              ) : (
                <button type="button" onClick={() => rearImageRef.current?.click()} disabled={uploadImagesMutation.isPending} style={{ width: '100%', height: '100%', border: '1px dashed #cbd5e1', borderRadius: '8px', background: '#ffffff', color: '#0062ff', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4, cursor: uploadImagesMutation.isPending ? 'not-allowed' : 'pointer' }}>
                  <span style={{ fontSize: 16 }}>↑</span>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>Upload Rear Image</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Column (Other Images) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ fontSize: 13, marginBottom: 8, color: '#1e293b', fontWeight: 500 }}>Other Images</div>
          <input type="file" ref={otherImagesRef} onChange={handleOtherImagesUpload} style={{ display: 'none' }} accept="image/*" multiple />

          <div style={{ flex: 1, border: '1px solid #eef0f3', borderRadius: '8px', padding: '12px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Main large image */}
            <div style={{ flex: 1, minHeight: '140px', borderRadius: '8px', overflow: 'hidden' }}>
               {item.images && item.images.length > 0 ? (
                 <ImageThumbnail
                   orgId={orgId}
                   itemId={itemId}
                   imageKey={item.images[0]}
                   onClick={() => openViewer(item.images[0])}
                 />
               ) : (
                 <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 13, background: '#f8fafc', borderRadius: '8px' }}>
                   No extra images
                 </div>
               )}
            </div>

            {/* Thumbnail row */}
            <div style={{ display: 'flex', gap: '8px', overflowX: 'auto', paddingBottom: '4px' }}>
              {item.images && item.images.length > 0 && item.images.map((img: string, idx: number) => (
                <div key={idx} style={{ width: '48px', height: '48px', flexShrink: 0, border: idx === 0 ? '2px solid #3b82f6' : '1px solid transparent', borderRadius: '8px', padding: idx === 0 ? '2px' : '0' }}>
                  <ImageThumbnail
                    orgId={orgId}
                    itemId={itemId}
                    imageKey={img}
                    onClick={() => openViewer(img)}
                  />
                </div>
              ))}

              {/* Add More Button */}
              <button
                type="button"
                onClick={() => otherImagesRef.current?.click()}
                disabled={uploadImagesMutation.isPending}
                style={{ width: '48px', height: '48px', flexShrink: 0, border: '2px dashed #3b82f6', borderRadius: '8px', background: '#ffffff', color: '#3b82f6', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: uploadImagesMutation.isPending ? 'not-allowed' : 'pointer' }}
              >
                <Plus size={20} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {viewerOpen && (
        <ImageViewerModal
          isOpen={viewerOpen}
          onClose={() => setViewerOpen(false)}
          orgId={orgId}
          itemId={itemId}
          item={item}
          initialImageKey={viewerImageKey}
        />
      )}
    </>
  );
}
