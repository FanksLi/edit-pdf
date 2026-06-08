import { create } from 'zustand';
import { temporal } from 'zundo';

/**
 * Canvas 状态管理 Store
 *
 * 状态结构：
 * - pages: { [pageNum]: { objects: CanvasObject[] } }
 * - 每个 object 包含：id, type, left, top, width, height, scaleX, scaleY, angle, 以及类型特定属性
 *
 * zundo 自动管理历史记录，limit: 20 限制最多保存 20 步
 */

const useCanvasStore = create(
  temporal(
    (set, get) => ({
      // 当前文件 ID
      fileId: null,

      // 页面对象状态
      pages: {},

      // 当前可见页码
      currentPage: 0,

      // 初始化标记（用于判断是否应该记录历史）
      initialized: false,

      // ─── 文件管理 ────────────────────────────────────

      setFileId: (fileId) => set({ fileId, pages: {}, initialized: false }),

      // ─── 页面管理 ────────────────────────────────────

      // 初始化页面数据（不触发历史记录，由调用方控制）
      initPage: (pageNum, objects) => set((state) => ({
        pages: {
          ...state.pages,
          [pageNum]: { objects }
        }
      })),

      // 标记初始化完成
      setInitialized: (value) => set({ initialized: value }),

      clearPages: () => set({ pages: {}, initialized: false }),

      // 设置当前页面（不触发历史记录，因为 partialize 只记录 pages）
      setCurrentPage: (pageNum) => set({ currentPage: pageNum }),

      // ─── 对象操作 ────────────────────────────────────

      updateObject: (pageNum, objectId, updates) => set((state) => {
        const page = state.pages[pageNum];
        if (!page) return state;

        return {
          pages: {
            ...state.pages,
            [pageNum]: {
              ...page,
              objects: page.objects.map(obj =>
                obj.id === objectId ? { ...obj, ...updates } : obj
              )
            }
          }
        };
      }),

      addObject: (pageNum, object) => set((state) => {
        const page = state.pages[pageNum] || { objects: [] };
        return {
          pages: {
            ...state.pages,
            [pageNum]: {
              ...page,
              objects: [...page.objects, object]
            }
          }
        };
      }),

      removeObject: (pageNum, objectId) => set((state) => {
        const page = state.pages[pageNum];
        if (!page) return state;

        return {
          pages: {
            ...state.pages,
            [pageNum]: {
              ...page,
              objects: page.objects.filter(obj => obj.id !== objectId)
            }
          }
        };
      }),

      // 批量设置页面对象（用于撤销/重做恢复）
      setObjects: (pageNum, objects) => set((state) => ({
        pages: {
          ...state.pages,
          [pageNum]: { objects }
        }
      })),

      // ─── 辅助方法 ────────────────────────────────────

      getObject: (pageNum, objectId) => {
        const page = get().pages[pageNum];
        if (!page) return null;
        return page.objects.find(obj => obj.id === objectId) || null;
      },

      getPageObjects: (pageNum) => {
        const page = get().pages[pageNum];
        return page ? page.objects : [];
      },
    }),
    {
      limit: 20,
      // 只记录 pages 的变化，忽略 fileId、currentPage、initialized 等
      partialize: (state) => ({ pages: state.pages }),
      // 添加 equality 函数，只有 pages 变化时才记录历史
      equality: (pastState, currentState) => {
        return pastState.pages === currentState.pages;
      },
    }
  )
);

export default useCanvasStore;
