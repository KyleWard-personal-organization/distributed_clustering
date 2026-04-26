"""
Experiment 3: Data Scalability
- 折线图：总时间 vs 数据量（与 O(N²) 理论曲线对比）
- 堆叠面积图：三个 Phase 随 N 的变化
- 柱状图：局部边数 vs 全局MST边数（边压缩效果）
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import numpy as np
import os, sys
import re


# 自动将项目根目录添加到 sys.path 中，避免手动 export PYTHONPATH
current_dir = os.path.dirname(os.path.abspath(__file__))
project_root = os.path.abspath(os.path.join(current_dir, ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# ── 实验数据（4 cores，从控制台日志提取）─────────────────────────────────────
processor_name = "Intel Core i7"
N      = [1_000,  2_000,   5_000,    10_000]

# i7 data
phase1 = [ 5.3051,  3.5601,   3.7330,    5.1078]
phase2 = [ 6.2394,  8.0128,  31.2422,  122.2111]
phase3 = [ 1.1684,  4.0899,  29.0258,  142.3687]
total  = [12.8308, 16.0686,  66.3525,  280.5226]

# M1 data
# phase1 = [8.4817, 8.6358,  8.7653,   9.2916]
# phase2 = [9.0491, 8.8961, 14.7318,  50.1126]
# phase3 = [0.3433, 1.2368,  9.5790,  54.9087]
# total  = [17.9190, 18.9187, 33.9932, 118.0327]

local_edges  = [241_346, 986_906, 6_109_519, 24_516_479]
global_edges = [    999,   1_999,     4_999,      9_999]   # N-1




n_arr  = np.array(N, dtype=float)
on2    = (n_arr / N[0]) ** 2 * total[0]
on_logn= (n_arr / N[0]) * np.log2(n_arr / N[0] + 1) * total[0]

COLORS = {
    'phase1': '#4C72B0',
    'phase2': '#55A868',
    'phase3': '#C44E52',
    'total':  '#DD8452',
    'on2':    '#AAAAAA',
    'onlogn': '#8172B2',
    'local':  '#4C72B0',
    'global': '#C44E52',
}

x_labels = ['1k', '2k', '5k', '10k']

fig = plt.figure(figsize=(16, 10))
fig.patch.set_facecolor('#F8F9FA')

# ── 子图 1：总时间折线 ─────────────────────────────────────────────────────
ax1 = fig.add_subplot(2, 2, 1)
ax1.set_facecolor('#FFFFFF')

ax1.plot(N, on2, '--', color=COLORS['on2'], lw=1.8, label='O(N²) Reference', zorder=1)
ax1.plot(N, on_logn, ':', color=COLORS['onlogn'], lw=1.8, label='O(N log N) Reference', zorder=2)
ax1.plot(N, total, 'o-', color=COLORS['total'],  lw=2.2, markersize=8,
         markerfacecolor='white', markeredgewidth=2.2, label='Actual Total Time', zorder=3)

for xi, ti in zip(N, total):
    ax1.annotate(f'{ti:.1f}s', xy=(xi, ti), xytext=(6, 6),
                 textcoords='offset points', fontsize=9, color=COLORS['total'], fontweight='bold')

ax1.set_xscale('log')
ax1.set_xticks(N)
ax1.set_xticklabels(x_labels)
ax1.set_xlabel('Dataset Size (N)', fontsize=11)
ax1.set_ylabel('Total Time (seconds)', fontsize=11)
ax1.set_title('Total Runtime vs Dataset Size\n(4 cores, HDBSCAN)', fontsize=12, fontweight='bold')
ax1.legend(fontsize=9, framealpha=0.9)
ax1.grid(linestyle='--', alpha=0.4)
ax1.spines['top'].set_visible(False)
ax1.spines['right'].set_visible(False)

# ── 子图 2：各 Phase 时间折线 ────────────────────────────────────────────────
ax2 = fig.add_subplot(2, 2, 2)
ax2.set_facecolor('#FFFFFF')

ax2.plot(N, phase1, 's--', color=COLORS['phase1'], lw=1.8, markersize=7,
         markerfacecolor='white', markeredgewidth=2, label='Phase 1: Spatial Partitioning')
ax2.plot(N, phase2, 'o-',  color=COLORS['phase2'], lw=2.2, markersize=8,
         markerfacecolor='white', markeredgewidth=2.2, label='Phase 2: Build Local MSTs')
ax2.plot(N, phase3, '^-',  color=COLORS['phase3'], lw=2.2, markersize=8,
         markerfacecolor='white', markeredgewidth=2.2, label='Phase 3: Merge Global MST')

for xi, p2, p3 in zip(N, phase2, phase3):
    ax2.annotate(f'{p2:.1f}s', xy=(xi, p2), xytext=(-28, 6),
                 textcoords='offset points', fontsize=8, color=COLORS['phase2'])
    ax2.annotate(f'{p3:.1f}s', xy=(xi, p3), xytext=(6, -12),
                 textcoords='offset points', fontsize=8, color=COLORS['phase3'])

ax2.set_xscale('log')
ax2.set_xticks(N)
ax2.set_xticklabels(x_labels)
ax2.set_xlabel('Dataset Size (N)', fontsize=11)
ax2.set_ylabel('Phase Time (seconds)', fontsize=11)
ax2.set_title('Phase Breakdown vs Dataset Size\n(4 cores)', fontsize=12, fontweight='bold')
ax2.legend(fontsize=8.5, framealpha=0.9, loc='upper left')
ax2.grid(linestyle='--', alpha=0.4)
ax2.spines['top'].set_visible(False)
ax2.spines['right'].set_visible(False)

# ── 子图 3：边数对比柱状图 ─────────────────────────────────────────────────
ax3 = fig.add_subplot(2, 2, 3)
ax3.set_facecolor('#FFFFFF')

x_pos = np.arange(len(N))
bw = 0.35
b_local  = ax3.bar(x_pos - bw/2, local_edges,  bw, color=COLORS['local'],
                   label='Phase 2 Output Edges', alpha=0.85, edgecolor='white')
b_global = ax3.bar(x_pos + bw/2, global_edges, bw, color=COLORS['global'],
                   label='Global MST Edges', alpha=0.85, edgecolor='white')

for i, (le, ge) in enumerate(zip(local_edges, global_edges)):
    ax3.text(i - bw/2, le * 1.05, f'{le/1e6:.2f}M' if le >= 1e6 else f'{le/1e3:.0f}k',
             ha='center', fontsize=7.5, color=COLORS['local'], fontweight='bold')
    ax3.text(i + bw/2, ge * 1.05, f'{ge/1e3:.0f}k' if ge >= 1e3 else f'{ge}',
             ha='center', fontsize=7.5, color=COLORS['phase3'], fontweight='bold')

ax3.set_xticks(x_pos)
ax3.set_xticklabels(x_labels)
ax3.set_xlabel('Dataset Size (N)', fontsize=11)
ax3.set_ylabel('Edge Count', fontsize=11)
ax3.set_title('Edge Counts vs Dataset Size\n(Phase 2 Output and Global MST)', fontsize=12, fontweight='bold')
ax3.yaxis.set_major_formatter(ticker.FuncFormatter(lambda x, _: f'{x/1e6:.1f}M' if x >= 1e6 else f'{x/1e3:.0f}k'))

ax3.legend(fontsize=8.5, framealpha=0.9, loc='upper left')
ax3.grid(axis='y', linestyle='--', alpha=0.4)
ax3.spines['top'].set_visible(False)

# ── 子图 4：归一化运行时间 ─────────────────────────────────────────────────
ax4 = fig.add_subplot(2, 2, 4)
ax4.set_facecolor('#FFFFFF')

norm_total  = [t / total[0]  for t in total]
norm_phase1 = [p / phase1[0] for p in phase1]
norm_phase2 = [p / phase2[0] for p in phase2]
norm_phase3 = [p / phase3[0] for p in phase3]
norm_n      = [n / N[0]      for n in N]
norm_n2     = [(n / N[0])**2 for n in N]

ax4.plot(N, norm_n2,     '--', color=COLORS['on2'],    lw=1.6, label='O(N²) Reference')
ax4.plot(N, norm_n,      ':',  color='#999999',        lw=1.6, label='O(N) Reference')
ax4.plot(N, norm_total,  'o-', color=COLORS['total'],  lw=2,   markersize=7,
         markerfacecolor='white', markeredgewidth=2, label='Total time (normalized)')
ax4.plot(N, norm_phase1, 'd-', color=COLORS['phase1'], lw=2,   markersize=7,
         markerfacecolor='white', markeredgewidth=2, label='Phase 1 (normalized)')
ax4.plot(N, norm_phase2, 's-', color=COLORS['phase2'], lw=2,   markersize=7,
         markerfacecolor='white', markeredgewidth=2, label='Phase 2 (normalized)')
ax4.plot(N, norm_phase3, '^-', color=COLORS['phase3'], lw=2,   markersize=7,
         markerfacecolor='white', markeredgewidth=2, label='Phase 3 (normalized)')

for xi, nt in zip(N, norm_total):
    ax4.annotate(f'{nt:.1f}x', xy=(xi, nt), xytext=(6, 4),
                 textcoords='offset points', fontsize=8.5, color=COLORS['total'], fontweight='bold')

ax4.set_xscale('log')
ax4.set_yscale('log')
ax4.set_xticks(N)
ax4.set_xticklabels(x_labels)
ax4.set_xlabel('Dataset Size (N)', fontsize=11)
ax4.set_ylabel('Normalized Time (×, relative to N=1k)', fontsize=10)
ax4.set_title('Normalized Runtime vs Dataset Size\n(Relative to N=1k)', fontsize=12, fontweight='bold')
ax4.legend(fontsize=8.5, framealpha=0.9)
ax4.grid(linestyle='--', alpha=0.4)
ax4.spines['top'].set_visible(False)
ax4.spines['right'].set_visible(False)

# ── 大标题 ──────────────────────────────────────────────────────────────────
fig.suptitle(f'Experiment 3: Data Scalability — Distributed HDBSCAN (4 Cores)  |  Processor: {processor_name}',
             fontsize=14, fontweight='bold', y=0.98)

plt.tight_layout(rect=[0, 0, 1, 0.97])
out_dir = os.path.join(project_root, 'imgs')
if not os.path.exists(out_dir):
    os.makedirs(out_dir, exist_ok=True)
processor_suffix = re.sub(r'[^A-Za-z0-9]+', '_', processor_name).strip('_').lower()
out_file_name = f'experiment3_data_scalability_{processor_suffix}.png'
out_path = os.path.join(out_dir, out_file_name)
plt.savefig(out_path, dpi=150, bbox_inches='tight', facecolor=fig.get_facecolor())
print(f'Saved → {out_path}')
