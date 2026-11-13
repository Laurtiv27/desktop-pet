'use strict';
/**
 * 截一帧显示器，返回 JPEG base64。不落盘、不建流。
 * `pet:capture-screen` 与屏幕感知调度共用。
 * @module dsh-pet/runtime/electron-helper/main/capture-screen
 */

/**
 * @param {object} [display] - Electron Display。缺省或没有 size 时返回 null。
 * @param {{ getSources?: Function }} [desktopCapturer]
 * @returns {Promise<{ mediaType: string, data: string, width: number, height: number, bytes: number } | null>}
 */
async function captureScreenJpeg(display, desktopCapturer) {
  if (!display || !display.size || !desktopCapturer || typeof desktopCapturer.getSources !== 'function') {
    return null;
  }
  const scale = display.scaleFactor || 1;
  const size = {
    width: Math.max(1, Math.min(4096, Math.round(display.size.width * scale))),
    height: Math.max(1, Math.min(4096, Math.round(display.size.height * scale))),
  };
  const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: size });
  const list = Array.isArray(sources) ? sources : [];
  // display_id 是字符串；对不上时退回第一块，总比点了没反应好。
  const source = list.find((item) => String(item.display_id) === String(display.id)) ?? list[0];
  if (!source || !source.thumbnail || source.thumbnail.isEmpty()) return null;
  const thumbnail = source.thumbnail;
  const { width, height } = thumbnail.getSize();
  const data = thumbnail.toJPEG(85).toString('base64');
  return { mediaType: 'image/jpeg', data, width, height, bytes: Math.floor((data.length * 3) / 4) };
}

module.exports = { captureScreenJpeg };
