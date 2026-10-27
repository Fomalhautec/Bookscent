/**
 * 量一张图的宽高比（宽 ÷ 高）。
 *
 * 书脊/封面贴上自定义图片之后，书脊的厚度与封面的宽度就该听图片的 ——
 * 否则 cover 会把图裁掉一条。比例在这里量一次存进样式，
 * 渲染时就不用每帧去解码图片了。
 *
 * 量不出来（图坏了、格式太怪）就返回 null，调用方沿用兜底比例。
 */
export function measureImageAspect(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      resolve(img.naturalWidth > 0 && img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : null)
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}
