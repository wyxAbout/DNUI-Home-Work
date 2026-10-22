import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: '作业整合看板',
    description: '汇总教学平台中的未提交作业',
    permissions: ['storage', 'notifications', 'tabs'],
    host_permissions: [
      'https://study.neusoft.edu.cn/*',
      'https://www.pigai.org/*',
      'https://*.pigai.org/*',
      'https://sso.unipus.cn/*',
      'https://itestcloud.unipus.cn/*',
      'https://*.unipus.cn/*',
    ],
    action: {
      default_title: '打开作业看板',
      default_popup: 'popup.html',
    },
  },
});
