import { useCallback, useMemo, useState } from 'react';

interface UseVirtualScrollOptions {
  itemCount: number;
  itemHeight: number;
  containerHeight: number;
  overscanCount?: number;
}

interface VirtualRange {
  startIndex: number;
  endIndex: number;
  visibleStartIndex: number;
  visibleEndIndex: number;
}

export const useVirtualScroll = ({
  itemCount,
  itemHeight,
  containerHeight,
  overscanCount = 3,
}: UseVirtualScrollOptions) => {
  const [scrollOffset, setScrollOffset] = useState(0);

  const range = useMemo((): VirtualRange => {
    const visibleStartIndex = Math.max(0, Math.floor(scrollOffset / itemHeight));
    const visibleEndIndex = Math.ceil((scrollOffset + containerHeight) / itemHeight);
    
    const startIndex = Math.max(0, visibleStartIndex - overscanCount);
    const endIndex = Math.min(itemCount, visibleEndIndex + overscanCount);

    return {
      startIndex,
      endIndex,
      visibleStartIndex,
      visibleEndIndex,
    };
  }, [scrollOffset, itemHeight, containerHeight, itemCount, overscanCount]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    setScrollOffset(target.scrollTop);
  }, []);

  return {
    handleScroll,
    range,
    scrollOffset,
    offscreenStartSize: range.startIndex * itemHeight,
    offscreenEndSize: Math.max(0, (itemCount - range.endIndex) * itemHeight),
  };
};
