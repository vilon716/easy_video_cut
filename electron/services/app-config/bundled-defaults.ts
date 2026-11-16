/**
 * 出厂预置配置（自己人体验版）：新装用户还没填配置中心时，用这里的值兜底，
 * 装上就能用，不用一个个填 Key。
 *
 * ⚠️ 安全约定（务必遵守）：
 * - 仓库里的这份必须保持空对象——API Key 一旦提交进 GitHub 就等于公开泄露，
 *   任何人都能盗刷额度。
 * - 真实 Key 只写在打包机本地的这一份里，并用
 *     git update-index --skip-worktree electron/services/app-config/bundled-defaults.ts
 *   锁定：Git 不再提示它的改动，提交/推送都不会带上它。
 * - 本地打包（electron-builder）会把真实值编进安装包；GitHub Actions 云端
 *   打包用的是仓库里的空模板，云端包不带 Key（Windows 用户走配置文件导入）。
 */
import type { AppConfig } from "./index";

export const BUNDLED_DEFAULTS: Partial<AppConfig> = {};
