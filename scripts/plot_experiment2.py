"""
Experiment 2: Strong Scaling - Number of Cores
绘制堆叠柱状图 + 加速比曲线
"""

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import numpy as np

# ── 实验数据（从控制台日志提取）────────────────────────────────────────────────
cores = [1, 2, 4]

phase1 = [9.4157,   6.3747,   4.4397]   # _spatial_partitioning
phase2 = [202.6561, 130.7947, 120.7852] # _build_local_mst
phase3 = [118.8170, 119.9011, 126.7119] # _merge_global_mst

total  = [p1 + p2 + p3 for p1, p2, p3 in zip(phase1, phase2, phase3)]
# Speedup = T1 / Tn
speedup = [total[0] / t for t in total]
# 理想线性加速
ideal_speedup = [1, 2, 4]

# ── 颜色与样式 ──────────────────────────────────────────────────────────────
COLORS = {
    'phase1': '#4C72B0',
    'phase2': '#55A868',
    'phase3': '#C44E52',
    'speedup': '#DD8452',
    'ideal':   '#8C8C8C',
}

x = np.arange(len(cores))
bar_width = 0.45

fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13, 5.5))
fig.patch.set_facecolor('#F8F9FA')
for ax in (ax1, ax2):
    ax.set_facecolor('#FFFFFF')

# ── 左图：堆叠柱状图 ────────────────────────────────────────────────────────
b1 = ax1.bar(x, phase1, bar_width, label='Phase 1: Spatial Partitioning',
             color=COLORS['phase1'], edgecolor='white', linewidth=0.8)
b2 = ax1.bar(x, phase2, bar_width, bottom=phase1,
             label='Phase 2: Build Local MSTs (Parallel)',
             color=COLORS['phase2'], edgecolor='white', linewidth=0.8)
b3 = ax1.bar(x, phase3, bar_width,
             bottom=[p1 + p2 for p1, p2 in zip(phase1, phase2)],
             label='Phase 3: Merge Global MST (Serial)',
             color=COLORS['phase3'], edgecolor='white', linewidth=0.8)

# 在每段中间标注数值
def annotate_bars(ax, bars, bottoms, values, threshold=8):
    for bar, bot, val in zip(bars, bottoms, values):
        if val >= threshold:
            ax.text(bar.get_x() + bar.get_width() / 2,
                    bot + val / 2,
                    f'{val:.1f}s',
                    ha='center', va='center',
                    fontsize=8.5, color='white', fontweight='bold')

annotate_bars(ax1, b1, [0]*3, phase1, threshold=3)
annotate_bars(ax1, b2, phase1, phase2)
annotate_bars(ax1, b3, [p1+p2 for p1, p2 in zip(phase1, phase2)], phase3)

# 柱顶标总时间
for xi, tot in zip(x, total):
    ax1.text(xi, tot + 3, f'{tot:.1f}s', ha='center', va='bottom',
             fontsize=9, fontweight='bold', color='#333333')

ax1.set_xticks(x)
ax1.set_xticklabels([f'{c} Core{"s" if c > 1 else ""}' for c in cores], fontsize=11)
ax1.set_xlabel('Number of Cores', fontsize=12)
ax1.set_ylabel('Time (seconds)', fontsize=12)
ax1.set_title('Strong Scaling: Phase Breakdown\n(10,000 points, HDBSCAN)', fontsize=13, fontweight='bold', pad=12)
ax1.legend(loc='upper right', fontsize=9, framealpha=0.9)
ax1.set_ylim(0, max(total) * 1.15)
ax1.yaxis.set_minor_locator(ticker.AutoMinorLocator())
ax1.grid(axis='y', linestyle='--', alpha=0.4)
ax1.spines['top'].set_visible(False)
ax1.spines['right'].set_visible(False)

# ── 右图：加速比曲线 ─────────────────────────────────────────────────────────
ax2.plot(cores, ideal_speedup, '--', color=COLORS['ideal'],
         linewidth=1.8, label='Ideal Linear Speedup', zorder=2)
ax2.plot(cores, speedup, 'o-', color=COLORS['speedup'],
         linewidth=2.2, markersize=8, markerfacecolor='white',
         markeredgewidth=2.2, label='Actual Speedup', zorder=3)

for c, sp in zip(cores, speedup):
    ax2.annotate(f'{sp:.3f}x',
                 xy=(c, sp),
                 xytext=(8, 6), textcoords='offset points',
                 fontsize=9.5, color=COLORS['speedup'], fontweight='bold')

# Amdahl's Law 注解框
ax2.annotate(
    "Phase 3 (serial bottleneck)\nremains ~120s regardless of cores\n→ Amdahl's Law",
    xy=(4, speedup[2]),
    xytext=(2.3, 2.5),
    fontsize=8.5,
    color=COLORS['phase3'],
    arrowprops=dict(arrowstyle='->', color=COLORS['phase3'], lw=1.4),
    bbox=dict(boxstyle='round,pad=0.4', facecolor='#FFF0F0', edgecolor=COLORS['phase3'], alpha=0.9)
)

ax2.set_xticks(cores)
ax2.set_xticklabels([f'{c}' for c in cores], fontsize=11)
ax2.set_xlabel('Number of Cores', fontsize=12)
ax2.set_ylabel('Speedup  ($T_1 / T_n$)', fontsize=12)
ax2.set_title('Strong Scaling: Speedup Curve\n(Amdahl\'s Law Analysis)', fontsize=13, fontweight='bold', pad=12)
ax2.legend(loc='upper left', fontsize=9.5, framealpha=0.9)
ax2.set_xlim(0.5, 4.5)
ax2.set_ylim(0, max(ideal_speedup) * 1.25)
ax2.yaxis.set_minor_locator(ticker.AutoMinorLocator())
ax2.grid(linestyle='--', alpha=0.4)
ax2.spines['top'].set_visible(False)
ax2.spines['right'].set_visible(False)

# ── 底部注释 ────────────────────────────────────────────────────────────────
fig.text(0.5, 0.01,
         'Phase 2 (local MST build) scales well with cores — Embarrassingly Parallel.  '
         'Phase 3 (global MST merge at Driver) stays constant — Serial Bottleneck.',
         ha='center', fontsize=9, color='#555555',
         style='italic')

plt.tight_layout(rect=[0, 0.04, 1, 1])
out_path = 'data/experiment2_strong_scaling.png'
plt.savefig(out_path, dpi=150, bbox_inches='tight', facecolor=fig.get_facecolor())
print(f'Saved → {out_path}')
