"""检查原始 PDF 的绘图元素（装饰图形）"""
import fitz

original_path = r"C:\Users\Fan\Downloads\1059098842_qq_com_signed_signed (17).pdf"
doc = fitz.open(original_path)
page = doc[0]

print("=" * 60)
print("Content Stream 分析 - 查找绘图指令")
print("=" * 60)

# 获取 content stream
cs_xrefs = page.get_contents()
print(f"Content stream xrefs: {cs_xrefs}")

for xref in cs_xrefs:
    stream = doc.xref_stream(xref)
    if stream:
        decoded = stream.decode('latin-1', errors='ignore')
        # 查找矩形绘制指令
        lines = decoded.split('\n')

        rect_count = 0
        fill_count = 0

        for i, line in enumerate(lines):
            # 矩形定义: 数字 数字 数字 数字 re
            if ' re' in line:
                rect_count += 1
                parts = line.strip().split()
                if len(parts) >= 4:
                    try:
                        # 解析矩形参数
                        nums = []
                        for p in parts:
                            try:
                                nums.append(float(p))
                            except:
                                pass
                        if len(nums) >= 4:
                            w, h = nums[-4], nums[-3]  # 宽度和高度
                            # 大矩形可能是背景
                            if w > 100 or h > 10:
                                # 找前一行获取位置
                                if i > 0:
                                    prev = lines[i-1].strip()
                                    print(f"  [{i}] {prev} -> {line.strip()}")
                    except:
                        pass

            # 填充指令
            if ' f' in line or ' F' in line or ' B' in line:
                fill_count += 1

        print(f"\nStream xref={xref}: rects={rect_count}, fills={fill_count}")

# 检查页面是否有路径绘图
print("\n" + "=" * 60)
print("页面绘图对象")
print("=" * 60)

# PyMuPDF 提供的绘图信息
drawings = page.get_drawings()
print(f"绘图对象数量: {len(drawings)}")

for i, draw in enumerate(drawings[:10]):
    print(f"\n[{i}] type={draw.get('type')}, rect={draw.get('rect')}")
    items = draw.get('items', [])
    for item in items[:3]:
        print(f"  item: {item}")

# 检查是否有装饰矩形在"注册地址"区域附近
print("\n" + "=" * 60)
print("注册地址区域附近的绘图")
print("=" * 60)

register_area = fitz.Rect(50, 270, 350, 300)

for draw in drawings:
    rect = draw.get('rect')
    if rect and rect.intersects(register_area):
        print(f"  rect={rect}, type={draw.get('type')}")
        items = draw.get('items', [])
        for item in items:
            print(f"    item: {item}")

# 直接渲染原始页面，检查背景色
print("\n" + "=" * 60)
print("原始页面渲染 - 注册地址区域")
print("=" * 60)

# 渲染注册地址区域
pix = page.get_pixmap(matrix=fitz.Matrix(1, 1), clip=register_area, alpha=False)
print(f"Clip rect: {register_area}")
print(f"Pixmap size: {pix.width}x{pix.height}")

# 采样左上角像素（应该是最干净的背景）
bg_samples = []
for y in range(2, 10):
    for x in range(2, 10):
        idx = (y * pix.width + x) * 3
        bg_samples.append((pix.samples[idx], pix.samples[idx+1], pix.samples[idx+2]))

avg_bg = (
    sum(s[0] for s in bg_samples) // len(bg_samples),
    sum(s[1] for s in bg_samples) // len(bg_samples),
    sum(s[2] for s in bg_samples) // len(bg_samples),
)
print(f"左上角背景平均 RGB: {avg_bg}")

# 采样底部像素
bottom_samples = []
for y in range(pix.height - 10, pix.height - 2):
    for x in range(2, 10):
        idx = (y * pix.width + x) * 3
        bottom_samples.append((pix.samples[idx], pix.samples[idx+1], pix.samples[idx+2]))

avg_bottom = (
    sum(s[0] for s in bottom_samples) // len(bottom_samples),
    sum(s[1] for s in bottom_samples) // len(bottom_samples),
    sum(s[2] for s in bottom_samples) // len(bottom_samples),
)
print(f"底部背景平均 RGB: {avg_bottom}")

doc.close()
print("\nDone.")