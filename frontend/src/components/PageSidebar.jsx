import { useState, useEffect, useRef } from 'react';
import { getPageThumbnail } from '../services/api';

function PageSidebar({ fileId, pageCount, currentPage, onPageClick }) {
  const [thumbnails, setThumbnails] = useState({});
  const [isMobile, setIsMobile] = useState(false);

  // 检测移动端
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // 懒加载缩略图
  useEffect(() => {
    if (!fileId || pageCount === 0) return;

    const loadThumbnail = async (num) => {
      if (thumbnails[num]) return;
      try {
        const data = await getPageThumbnail(fileId, num);
        setThumbnails(prev => ({ ...prev, [num]: data }));
      } catch (e) {
        console.error(`Failed to load thumbnail ${num}:`, e);
      }
    };

    // 依次加载，不并发（低 DPI 小图很快）
    let cancelled = false;
    const loadAll = async () => {
      for (let i = 0; i < pageCount; i++) {
        if (cancelled) break;
        await loadThumbnail(i);
      }
    };
    loadAll();
    return () => { cancelled = true; };
  }, [fileId, pageCount]);

  // 手机端：底部水平滚动
  if (isMobile) {
    return (
      <div className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-gray-200 shadow-lg">
        <div className="flex overflow-x-auto gap-2 p-2 snap-x snap-mandatory">
          {Array.from({ length: pageCount }, (_, i) => (
            <button
              key={i}
              onClick={() => onPageClick(i)}
              className={`flex-shrink-0 snap-start rounded overflow-hidden border-2 transition-colors ${
                currentPage === i ? 'border-blue-500' : 'border-transparent'
              }`}
              style={{ width: 64 }}
            >
              {thumbnails[i] ? (
                <img
                  src={thumbnails[i].image_url}
                  alt={`Page ${i + 1}`}
                  className="w-full h-auto"
                  draggable={false}
                />
              ) : (
                <div className="w-16 h-20 bg-gray-100 flex items-center justify-center text-xs text-gray-400">
                  {i + 1}
                </div>
              )}
              <div className={`text-center text-xs py-0.5 ${
                currentPage === i ? 'text-blue-600 font-semibold' : 'text-gray-500'
              }`}>
                {i + 1}
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // PC 端：左侧纵向滚动
  return (
    <div className="w-[120px] flex-shrink-0 bg-gray-50 border-r border-gray-200 overflow-y-auto p-2 space-y-2">
      {Array.from({ length: pageCount }, (_, i) => (
        <button
          key={i}
          onClick={() => onPageClick(i)}
          className={`w-full rounded overflow-hidden border-2 transition-colors cursor-pointer ${
            currentPage === i ? 'border-blue-500 shadow-md' : 'border-gray-200 hover:border-gray-400'
          }`}
        >
          {thumbnails[i] ? (
            <img
              src={thumbnails[i].image_url}
              alt={`Page ${i + 1}`}
              className="w-full h-auto"
              draggable={false}
            />
          ) : (
            <div className="w-full aspect-[3/4] bg-gray-100 flex items-center justify-center text-xs text-gray-400">
              {i + 1}
            </div>
          )}
          <div className={`text-center text-xs py-1 ${
            currentPage === i ? 'text-blue-600 font-semibold' : 'text-gray-500'
          }`}>
            {i + 1}
          </div>
        </button>
      ))}
    </div>
  );
}

export default PageSidebar;
