import type { Item } from '../../../items/items.schemas';
import { compositeItemsApi } from '../compositeItems.api';

/**
 * Fetch all composite items across multiple pages if necessary
 */
export async function fetchAllCompositeItemsForExport(
  orgId: string,
  params: { search?: string; filter?: string; fieldFilters?: string } = {},
  onProgress?: (loaded: number) => void,
): Promise<Item[]> {
  const allItems: Item[] = [];
  let currentPage = 1;
  const perPage = 500;
  let hasMore = true;

  while (hasMore) {
    const response = await compositeItemsApi.getItems(orgId, {
      ...params,
      page: currentPage,
      perPage,
    });

    const pageResults = response.results ?? [];
    allItems.push(...pageResults);

    if (onProgress) {
      onProgress(allItems.length);
    }

    if (response.pageContext?.hasMore && pageResults.length > 0) {
      currentPage++;
    } else {
      hasMore = false;
    }
  }

  return allItems;
}
