import { useState, useRef, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, Plus, Download, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { itemsApi } from '../items.api';
import type { Item, ItemFormData } from '../items.schemas';

function getImageKey(img: unknown): string | null {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (
    typeof img === 'object' &&
    img !== null &&
    'key' in img &&
    typeof (img as { key: unknown }).key === 'string'
  ) {
    return (img as { key: string }).key;
  }
  return null;
}

// --- Image Viewer Modal ---
function ImageViewerModal({
  isOpen,
  onClose,
  orgId,
  itemId,
  item,
  initialImageKey,
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
    const frontKey = getImageKey(item.frontImage);
    const rearKey = getImageKey(item.rearImage);
    if (frontKey) imgs.push(frontKey);
    if (rearKey) imgs.push(rearKey);
    if (Array.isArray(item.images)) {
      item.images.forEach((img) => {
        const k = getImageKey(img);
        if (k) imgs.push(k);
      });
    }
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
      queryClient.invalidateQueries({ queryKey: ['items', orgId] });
    },
  });

  const handleMarkAsFront = () => {
    if (!activeImageKey) return;
    const currentFrontKey = getImageKey(item.frontImage);
    if (activeImageKey === currentFrontKey) return;

    const newImages = [...(item.images || [])];
    let activeImageObj: unknown = activeImageKey;
    const updatePayload: Partial<ItemFormData> = {};

    const index = newImages.findIndex((img) => getImageKey(img) === activeImageKey);
    if (index !== -1) {
      // Image was in 'Other images'
      activeImageObj = newImages[index];
      newImages.splice(index, 1);
      if (item.frontImage) {
        newImages.push(item.frontImage);
      }
    } else if (activeImageKey === getImageKey(item.rearImage)) {
      // Image was 'Rear image', so swap old front to rear
      activeImageObj = item.rearImage;
      updatePayload.rearImage = (item.frontImage || null) as unknown as string;
    }

    updatePayload.frontImage = activeImageObj as unknown as string;
    updatePayload.images = newImages as unknown as string[];

    updateItemMutation.mutate(updatePayload);
  };

  const handleDeleteImage = () => {
    if (!activeImageKey) return;
    const frontKey = getImageKey(item.frontImage);
    const rearKey = getImageKey(item.rearImage);

    const updatePayload: Partial<ItemFormData> = {};
    let isDeleted = false;

    if (activeImageKey === frontKey) {
      updatePayload.frontImage = null as unknown as string;
      isDeleted = true;
    }
    if (activeImageKey === rearKey) {
      updatePayload.rearImage = null as unknown as string;
      isDeleted = true;
    }
    if (
      Array.isArray(item.images) &&
      item.images.some((img) => getImageKey(img) === activeImageKey)
    ) {
      updatePayload.images = item.images.filter(
        (img) => getImageKey(img) !== activeImageKey,
      ) as unknown as string[];
      isDeleted = true;
    }

    if (isDeleted) {
      updateItemMutation.mutate(updatePayload);
    }
    onClose();
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
        padding: '24px',
      }}
    >
      <div style={{ position: 'absolute', top: '24px', right: '24px' }}>
        <button
          onClick={onClose}
          style={{
            background: '#000',
            border: 'none',
            borderRadius: '50%',
            width: '44px',
            height: '44px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'white',
            transition: 'background 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#333')}
          onMouseLeave={(e) => (e.currentTarget.style.background = '#000')}
        >
          <X size={24} />
        </button>
      </div>

      <div
        style={{
          background: 'white',
          borderRadius: '16px',
          width: '560px',
          height: '520px',
          maxWidth: '90vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          position: 'relative',
          overflow: 'hidden',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
          boxSizing: 'border-box',
        }}
      >
        {/* Main Image Area */}
        <div
          style={{
            height: '360px',
            width: '100%',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '16px 56px',
            boxSizing: 'border-box',
          }}
        >
          {/* Nav Arrows */}
          {activeIndex > 0 && (
            <button
              onClick={handlePrevious}
              style={{
                position: 'absolute',
                left: '16px',
                background: '#000',
                color: '#fff',
                border: 'none',
                borderRadius: '50%',
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                zIndex: 10,
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#333')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#000')}
            >
              <ChevronLeft size={24} />
            </button>
          )}

          {url && (
            <img
              src={url}
              alt="Viewer"
              style={{
                maxWidth: '100%',
                maxHeight: '320px',
                objectFit: 'contain',
                display: 'block',
                borderRadius: '8px',
              }}
            />
          )}

          {activeIndex >= 0 && activeIndex < allImages.length - 1 && (
            <button
              onClick={handleNext}
              style={{
                position: 'absolute',
                right: '16px',
                background: '#000',
                color: '#fff',
                border: 'none',
                borderRadius: '50%',
                width: '40px',
                height: '40px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                zIndex: 10,
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = '#333')}
              onMouseLeave={(e) => (e.currentTarget.style.background = '#000')}
            >
              <ChevronRight size={24} />
            </button>
          )}
        </div>

        {/* Thumbnails */}
        <div
          style={{
            height: '70px',
            padding: '0 24px 12px',
            display: 'flex',
            gap: '8px',
            justifyContent: 'center',
            alignItems: 'center',
            boxSizing: 'border-box',
          }}
        >
          {allImages.map((imgKey, idx) => (
            <div
              key={idx}
              onClick={() => setActiveImageKey(imgKey)}
              style={{
                width: '44px',
                height: '44px',
                border: activeImageKey === imgKey ? '2px solid #3b82f6' : '1px solid #eef0f3',
                borderRadius: '8px',
                padding: activeImageKey === imgKey ? '2px' : '0',
                cursor: 'pointer',
                overflow: 'hidden',
              }}
            >
              <ImageThumbnail orgId={orgId} itemId={itemId} imageKey={imgKey} maxImgHeight="40px" />
            </div>
          ))}
        </div>

        {/* Bottom Bar */}
        <div
          style={{
            height: '58px',
            padding: '0 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderTop: '1px solid #eef0f3',
            boxSizing: 'border-box',
            background: '#fff',
          }}
        >
          <div style={{ width: '120px' }}>
            {activeImageKey !== getImageKey(item.frontImage) && (
              <button
                onClick={handleMarkAsFront}
                disabled={updateItemMutation.isPending}
                style={{
                  background: 'none',
                  border: 'none',
                  color: '#3b82f6',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: updateItemMutation.isPending ? 'not-allowed' : 'pointer',
                  padding: '8px 12px',
                  marginLeft: '-12px',
                }}
              >
                Mark as Front
              </button>
            )}
          </div>

          <button
            onClick={handleDownload}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              color: '#3b82f6',
              background: 'none',
              border: 'none',
              fontSize: '14px',
              fontWeight: 500,
              padding: '8px 12px',
              cursor: 'pointer',
            }}
          >
            <Download size={16} /> Download
          </button>

          <button
            onClick={handleDeleteImage}
            style={{
              background: 'none',
              border: 'none',
              color: '#ef4444',
              cursor: 'pointer',
              padding: '8px 12px',
            }}
          >
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
  onClick,
  maxImgHeight = '100%',
}: {
  orgId: string;
  itemId: string;
  imageKey: string;
  onDelete?: () => void;
  onClick?: (url: string) => void;
  maxImgHeight?: string;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const { data: url, isLoading } = useQuery({
    queryKey: ['signedUrl', orgId, itemId, imageKey],
    queryFn: () => itemsApi.getSignedUrl(orgId, itemId, imageKey),
    enabled: Boolean(imageKey),
    staleTime: 1000 * 60 * 30, // 30 minutes
  });

  if (isLoading) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          background: '#f8fafc',
          borderRadius: '6px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '11px',
          color: '#94a3b8',
        }}
      >
        Loading...
      </div>
    );
  }

  if (!url) return null;

  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: '100%',
        borderRadius: '6px',
        overflow: 'hidden',
        background: '#ffffff',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
      onClick={() => onClick?.(url)}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <img
        src={url}
        alt="Item"
        style={{
          maxWidth: '100%',
          maxHeight: maxImgHeight,
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
        }}
      />
      {onDelete && isHovered && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="Delete image"
          style={{
            position: 'absolute',
            top: '4px',
            right: '4px',
            background: 'rgba(255, 255, 255, 0.9)',
            border: '1px solid #cbd5e1',
            borderRadius: '4px',
            color: '#ef4444',
            cursor: 'pointer',
            padding: '3px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 5,
          }}
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}

// --- Main Gallery Component ---
export function ItemImageGallery({
  orgId,
  itemId,
  item,
}: {
  orgId: string;
  itemId: string;
  item: Item;
}) {
  const queryClient = useQueryClient();
  const frontImageRef = useRef<HTMLInputElement>(null);
  const rearImageRef = useRef<HTMLInputElement>(null);
  const otherImagesRef = useRef<HTMLInputElement>(null);

  const [selectedOtherIndex, setSelectedOtherIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerImageKey, setViewerImageKey] = useState<string | null>(null);

  const frontKey = getImageKey(item.frontImage);
  const rearKey = getImageKey(item.rearImage);

  const otherImagesList = useMemo(() => {
    return Array.isArray(item.images) ? item.images : [];
  }, [item.images]);

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

  const updateItemMutation = useMutation({
    mutationFn: (data: Partial<ItemFormData>) => itemsApi.updateItem({ orgId, id: itemId, data }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['item', orgId, itemId] });
      queryClient.invalidateQueries({ queryKey: ['items', orgId] });
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
      Array.from(e.target.files).forEach((file) => {
        formData.append('images', file);
      });
      uploadImagesMutation.mutate(formData);
    }
  };

  const handleDeleteFrontImage = () => {
    updateItemMutation.mutate({ frontImage: null as unknown as string });
  };

  const handleDeleteRearImage = () => {
    updateItemMutation.mutate({ rearImage: null as unknown as string });
  };

  const handleDeleteOtherImage = (indexToDelete: number) => {
    const updatedImages = otherImagesList.filter((_, idx) => idx !== indexToDelete);
    updateItemMutation.mutate({ images: updatedImages as unknown as string[] });
    if (selectedOtherIndex >= updatedImages.length && updatedImages.length > 0) {
      setSelectedOtherIndex(updatedImages.length - 1);
    } else {
      setSelectedOtherIndex(0);
    }
  };

  const activeOtherIndex =
    otherImagesList.length > 0 ? Math.min(selectedOtherIndex, otherImagesList.length - 1) : 0;
  const activeOtherKey = otherImagesList[activeOtherIndex]
    ? getImageKey(otherImagesList[activeOtherIndex])
    : null;

  return (
    <>
      <div
        style={{
          border: '1px solid #eef0f3',
          borderRadius: '12px',
          padding: '16px',
          display: 'flex',
          gap: '16px',
          background: '#fff',
          boxSizing: 'border-box',
          height: '252px',
        }}
      >
        {/* Left Column (Front & Rear) */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            width: '140px',
            flexShrink: 0,
          }}
        >
          <div>
            <div
              style={{ fontSize: '13px', marginBottom: '6px', color: '#1e293b', fontWeight: 500 }}
            >
              Front View
            </div>
            <input
              type="file"
              ref={frontImageRef}
              onChange={handleFrontImageUpload}
              style={{ display: 'none' }}
              accept="image/*"
            />
            <div
              style={{
                height: '85px',
                border: '1px solid #eef0f3',
                borderRadius: '8px',
                overflow: 'hidden',
                position: 'relative',
                background: '#fafafa',
              }}
            >
              {frontKey ? (
                <ImageThumbnail
                  orgId={orgId}
                  itemId={itemId}
                  imageKey={frontKey}
                  onClick={() => openViewer(frontKey)}
                  onDelete={handleDeleteFrontImage}
                  maxImgHeight="75px"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => frontImageRef.current?.click()}
                  disabled={uploadImagesMutation.isPending}
                  style={{
                    width: '100%',
                    height: '100%',
                    border: '1px dashed #cbd5e1',
                    borderRadius: '8px',
                    background: '#ffffff',
                    color: '#0062ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    cursor: uploadImagesMutation.isPending ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span style={{ fontSize: 16 }}>↑</span>
                  <span style={{ fontSize: 12, fontWeight: 500 }}>Upload</span>
                </button>
              )}
            </div>
          </div>

          <div>
            <div
              style={{ fontSize: '13px', marginBottom: '6px', color: '#1e293b', fontWeight: 500 }}
            >
              Rear View
            </div>
            <input
              type="file"
              ref={rearImageRef}
              onChange={handleRearImageUpload}
              style={{ display: 'none' }}
              accept="image/*"
            />
            <div
              style={{
                height: '85px',
                border: '1px solid #eef0f3',
                borderRadius: '8px',
                overflow: 'hidden',
                position: 'relative',
                background: '#fafafa',
              }}
            >
              {rearKey ? (
                <ImageThumbnail
                  orgId={orgId}
                  itemId={itemId}
                  imageKey={rearKey}
                  onClick={() => openViewer(rearKey)}
                  onDelete={handleDeleteRearImage}
                  maxImgHeight="75px"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => rearImageRef.current?.click()}
                  disabled={uploadImagesMutation.isPending}
                  style={{
                    width: '100%',
                    height: '100%',
                    border: '1px dashed #cbd5e1',
                    borderRadius: '8px',
                    background: '#ffffff',
                    color: '#0062ff',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 2,
                    cursor: uploadImagesMutation.isPending ? 'not-allowed' : 'pointer',
                  }}
                >
                  <span style={{ fontSize: 16 }}>↑</span>
                  <span style={{ fontSize: 11, fontWeight: 500 }}>Upload Rear</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Right Column (Other Images) */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ fontSize: '13px', marginBottom: '6px', color: '#1e293b', fontWeight: 500 }}>
            Other Images
          </div>
          <input
            type="file"
            ref={otherImagesRef}
            onChange={handleOtherImagesUpload}
            style={{ display: 'none' }}
            accept="image/*"
            multiple
          />

          <div
            style={{
              height: '194px',
              border: '1px solid #eef0f3',
              borderRadius: '8px',
              padding: '8px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              background: '#fafafa',
              boxSizing: 'border-box',
            }}
          >
            {/* Main large image inside Other Images */}
            <div
              style={{
                height: '128px',
                width: '100%',
                borderRadius: '6px',
                overflow: 'hidden',
                border: '1px solid #e2e8f0',
                background: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              {activeOtherKey ? (
                <ImageThumbnail
                  orgId={orgId}
                  itemId={itemId}
                  imageKey={activeOtherKey}
                  onClick={() => openViewer(activeOtherKey)}
                  onDelete={() => handleDeleteOtherImage(activeOtherIndex)}
                  maxImgHeight="115px"
                />
              ) : (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#94a3b8',
                    fontSize: 12,
                    background: '#f8fafc',
                  }}
                >
                  No extra images
                </div>
              )}
            </div>

            {/* Thumbnail row */}
            <div
              style={{
                display: 'flex',
                gap: '6px',
                overflowX: 'auto',
                alignItems: 'center',
                paddingBottom: '2px',
              }}
            >
              {otherImagesList.map((imgItem, idx: number) => {
                const imgKey = getImageKey(imgItem);
                if (!imgKey) return null;
                return (
                  <div
                    key={idx}
                    onClick={() => setSelectedOtherIndex(idx)}
                    style={{
                      width: '38px',
                      height: '38px',
                      flexShrink: 0,
                      border: idx === activeOtherIndex ? '2px solid #0062ff' : '1px solid #e2e8f0',
                      borderRadius: '6px',
                      padding: '1px',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      background: '#fff',
                    }}
                  >
                    <ImageThumbnail orgId={orgId} itemId={itemId} imageKey={imgKey} />
                  </div>
                );
              })}

              {/* Add More Button */}
              <button
                type="button"
                onClick={() => otherImagesRef.current?.click()}
                disabled={uploadImagesMutation.isPending}
                style={{
                  width: '38px',
                  height: '38px',
                  flexShrink: 0,
                  border: '1.5px dashed #0062ff',
                  borderRadius: '6px',
                  background: '#ffffff',
                  color: '#0062ff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: uploadImagesMutation.isPending ? 'not-allowed' : 'pointer',
                }}
                title="Add Images"
              >
                <Plus size={18} strokeWidth={2.5} />
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
