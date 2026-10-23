// 各平台解析器依赖的关键 DOM 选择器集中配置（反馈 2.3：选择器抽成配置）。
//
// 设计要点：
// - 只收录“脆弱且有结构意义”的 DOM 选择器；纯文本正则解析（东软/批改网/iTEST 的可见文案锚点）
//   不依赖 CSS 类名，不在此列。学校/平台改版时，优先只改本文件。
// - selectorsVersion：每次调整选择器 +1，便于在诊断工具与同步异常中区分“旧选择器留下的缓存”。
// - SelectorError / requireSelector：关键结构锚点在有界等待后仍缺失时抛出，由 content.ts 捕获并
//   转为 needs-verification（显式报错），而不是静默跳过或清空缓存（反馈 2.3：失效时明确报错）。

import type { PlatformId } from './models';

export const SELECTORS_VERSION = 1;

export interface SelectorConfig {
  /** 列表容器 / 关键结构锚点：用于判断页面是否真的渲染成功。 */
  listContainer?: string;
  /** 列表项选择器。 */
  item?: string;
  /** 关键字段选择器（按需，不要求每个平台都有）。 */
  fields: Record<string, string>;
  /** 空态标记（命中才算“真的为空”，否则视为结构变化）。 */
  emptyMarker?: string;
  /** 分页控件（学习通收件箱翻页用，见 2.5）。 */
  pagination?: {
    /** 分页条容器（如 Element UI 的分页条）。 */
    container: string;
    /** “下一页”按钮的可点击文本（按顺序匹配）。 */
    nextTexts: string[];
  };
}

export const PLATFORM_SELECTOR_CONFIG: Record<PlatformId, SelectorConfig> = {
  neusoft: {
    listContainer: '.v-content-wrap, .my-task, .v-layout-content',
    item: '.el-tabs__item, .ant-tabs-tab, [role="tab"]',
    fields: {
      contentWrap: '.v-content-wrap',
      myTask: '.my-task',
      layoutContent: '.v-layout-content',
      assignmentTab: '.el-tabs__item, .ant-tabs-tab, [role="tab"]',
      emptyMarker: '.el-empty, .neu-empty, .no-data-content, .noData, .data-empty',
      homeTaskBlock: 'span, div, h2, h3, h4',
      courseTitle:
        '.v-content-wrap h1, .v-content-wrap h2, .course-title, .course-header .title, h1',
    },
    emptyMarker: '.el-empty, .neu-empty, .no-data-content, .noData, .data-empty',
  },
  pigai: {
    listContainer: '#essayList',
    item: 'ul.reItemS',
    fields: {
      statusTab: 'li.showST',
      activeTabClass: 'select',
      row: 'ul.reItemS',
      titleLink: 'li.stu_title a',
      nickname: '#pigai_nickname',
      listHeader: '#essayList',
    },
  },
  itest: {
    listContainer: '[class*="stuClsInfo"]',
    fields: {
      classInfo: '[class*="stuClsInfo"]',
    },
  },
  chaoxing: {
    listContainer: 'li.dataBody_item',
    item: 'li.dataBody_item',
    fields: {
      title: '.notice_title',
      time: '.notice_time',
      sender: '.receiverName',
      detailUrl: '.openNotice',
      detailUrlAttr: 'data-url',
      itemIdAttr: 'data-id',
    },
    pagination: {
      container: '.el-pagination, .pagination, .page',
      nextTexts: ['下一页', '下页', 'next', '»', '>'],
    },
  },
};

// 关键结构锚点缺失时抛出的错误；由 content.ts 捕获并转为 needs-verification（显式报错），
// 而不是静默跳过或清空缓存（反馈 2.3）。
export class SelectorError extends Error {
  public readonly platformId: PlatformId;
  public readonly selector: string;
  public readonly context: string;
  constructor(platformId: PlatformId, selector: string, context: string) {
    super(
      `[${platformId}] 关键选择器 "${selector}" 未命中（${context}），可能平台已改版或页面未渲染`,
    );
    this.name = 'SelectorError';
    this.platformId = platformId;
    this.selector = selector;
    this.context = context;
  }
}

// 有界等待后若关键锚点仍缺失，抛出 SelectorError（由上层转为 needs-verification）。
export function requireSelector(
  doc: Document,
  selector: string,
  platformId: PlatformId,
  context: string,
): void {
  if (!doc.querySelector(selector)) {
    throw new SelectorError(platformId, selector, context);
  }
}
