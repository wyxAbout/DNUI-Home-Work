import { defineConfig } from 'wxt';

// 每次构建生成一个唯一标识，注入到所有产物（popup 与 content script 共享）。
// popup 用它判断页面内运行的 content script 是否属于当前版本。
const BUILD_ID = new Date().toISOString();

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    define: {
      __HW_BUILD_ID__: JSON.stringify(BUILD_ID),
    },
  }),
  manifest: {
    name: '作业整合看板',
    description: '汇总教学平台中的未提交作业',
    permissions: ['storage', 'notifications', 'tabs', 'scripting'],
    host_permissions: [
      'https://study.neusoft.edu.cn/*',
      'https://www.pigai.org/*',
      'https://*.pigai.org/*',
      'https://sso.unipus.cn/*',
      'https://itestcloud.unipus.cn/*',
      'https://*.unipus.cn/*',
      'https://i.chaoxing.com/*',
      'https://notice.chaoxing.com/*',
    ],
    action: {
      default_title: '打开作业看板',
      default_popup: 'popup.html',
    },
  },
});
