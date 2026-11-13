/**
 * 本地类型桩：独立包不再安装 @deepseek-ai/dsh-client-ui-primitives。
 * 只覆盖源码里的类型导入，让 tsc 在没有该包时能通过。
 */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  import type { ComponentType } from 'react';

  export interface IconProps {
    size?: number;
  }

  export const Button: ComponentType<Record<string, unknown>>;
  export const Modal: ComponentType<Record<string, unknown>>;
  export const ImageLightbox: ComponentType<Record<string, unknown>>;
  export const IconQueueOutlineRegular: ComponentType<IconProps>;
  export const IconUsersOutlineRegular: ComponentType<IconProps>;
  export const IconGaugeOutlineRegular: ComponentType<IconProps>;
  export const IconSlidersTwoOutlineMedium: ComponentType<IconProps>;
}
