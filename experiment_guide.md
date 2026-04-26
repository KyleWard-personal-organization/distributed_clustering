# 分布式 HDBSCAN 实验设计与评估指南 (Experiment Guide)

## 0. 导言：为什么要做这些实验？
作为一项分布式算法的“深度作业 (Deep Project)”，仅仅“跑通代码”是不够的。你需要通过精心设计的实验，向教授证明两件事：
1. **你懂机器学习**：你明白为什么我们要费劲去实现 HDBSCAN 而不是普通的 DBSCAN（即算法优越性）。
2. **你懂分布式系统**：你明白 MapReduce 的核心思想，能证明你设计的系统在计算资源（Cores）和数据量（Data Size）增加时具有极佳的**扩展性 (Scalability)**，并且深刻理解系统的串行瓶颈 (Amdahl's Law)。

为此，请严格按照以下四个实验组进行数据收集、作图与报告撰写。

---

## 实验组 1：算法有效性与优越性验证 (Algorithm Correctness & Superiority)

### 1.1 实验目的
证明普通的分布式 DBSCAN 无法处理“变密度 (Variable Density)”数据集，而你实现的分布式 HDBSCAN 可以完美解决这一痛点。

### 1.2 实验操作步骤
1. **准备数据**：使用项目内置的脚本生成二维变密度测试集（包含密集的半月形、稀疏的斑块、极密集的小斑块）。
   ```bash
   # 如果 data 目录下还没有 test_data_2k.csv，运行此命令
   python scripts/generate_data.py
   ```
2. **运行对照组 1：DBSCAN (小 `eps`)**
   ```bash
   ./run.sh --algo dbscan --data data/test_data_2k.csv --cores 4 --eps 0.3
   python scripts/visualize.py --file data/test_data_2k_dbscan_results_eps0.3.csv --title "DBSCAN (eps=0.3)"
   ```
3. **运行对照组 2：DBSCAN (大 `eps`)**
   ```bash
   ./run.sh --algo dbscan --data data/test_data_2k.csv --cores 4 --eps 1.0
   python scripts/visualize.py --file data/test_data_2k_dbscan_results_eps1.0.csv --title "DBSCAN (eps=1.0)"
   ```
4. **运行实验组：HDBSCAN**
   ```bash
   ./run.sh --algo hdbscan --data data/test_data_2k.csv --cores 4
   python scripts/visualize.py --file data/test_data_2k_hdbscan_results.csv --title "HDBSCAN"
   ```

### 1.3 预期结论与报告撰写要点
- 将三张生成的图片并排放在你的报告中。
- 指出 DBSCAN 的“死穴”：小 `eps` 会把稀疏簇当成噪声丢弃；大 `eps` 会把相邻的不同密度簇“粘”成一团。
- 结论：**HDBSCAN 通过树的 Stability 提取，摆脱了对单一距离阈值的依赖，是处理复杂现实数据的必然选择。**

---

## 实验组 2：强扩展性测试 (Strong Scaling - Number of Cores)

### 2.1 实验目的
这是分布式计算课的核心考点：固定总工作量，通过增加机器（或核心数），验证并行计算是否能按比例减少计算时间。你需要证明算法成功地将计算下推，实现了有效解耦。

### 2.2 实验操作步骤
1. **固定数据**：使用中等规模数据集，如 `test_data_10k.csv`。
2. **控制变量测试**：分别在 1, 2, 4（如果机器支持还可以测 8）个核心下运行 HDBSCAN：
   ```bash
   ./run.sh --algo hdbscan --data data/test_data_10k.csv --cores 1
   ./run.sh --algo hdbscan --data data/test_data_10k.csv --cores 2
   ./run.sh --algo hdbscan --data data/test_data_10k.csv --cores 4
   ```
3. **记录关键指标**：仔细阅读控制台输出日志，提取出以下三个核心耗时：
   - `_spatial_partitioning` 耗时 (Phase 1: 空间划分与数据网络传输)
   - `_build_local_mst` 耗时 (Phase 2: 并行计算距离与局部树构建)
   - `_merge_global_mst` 耗时 (Phase 3: Driver端单点串行树合并)
4. **绘制强扩展性图**：将记录的三个阶段耗时填入 `scripts/plot_experiment2.py` 开头的 `phase1 / phase2 / phase3` 数组，然后运行：
   ```bash
   python scripts/plot_experiment2.py
   # → imgs/experiment2_strong_scaling_<processor>.png
   ```

### 2.3 预期结论与报告撰写要点
- **作图**：画一张堆叠柱状图（X轴为 Core 数，Y轴为时间），用三种不同颜色代表 Phase 1, Phase 2, Phase 3。再画一张加速比曲线 ($Speedup = T_1 / T_n$)。
- **结论 1（局部图压缩的伟光正）**：指出 **Phase 2** 的时间随着核心数的增加几乎呈几何级数下降（完美并行 / Embarrassingly Parallel），证明 KD-Tree 空间划分有效解耦了图计算，避免了跨节点计算。
- **结论 2（展现深刻的系统视野）**：重点指出 **Phase 3** 的时间在不同核心数下保持不变（或略有波动）。告诉教授：因为全局合并必须在 Driver 端单点完成，这里受到**阿姆达尔定律 (Amdahl's Law)** 的限制。这展现了你不但会写代码，还能深刻洞察分布式系统的天然瓶颈。

---

## 实验组 3：弱扩展性与数据规模测试 (Data Scalability)

### 3.1 实验目的
证明你在系统设计中引入的“局部 MST (Local MST) 边压缩策略”有效地拯救了系统的内存并打破了原本 $O(N^2)$ 的时间复杂度诅咒。

### 3.2 实验操作步骤
1. **生成多组数据**：当前 `scripts/generate_data.py` 会生成 `1k, 2k, 5k, 10k` 四个规模的数据。
   ```bash
   python scripts/generate_data.py
   ```
2. **固定核心数运行**：例如全部使用 `--cores 4` 运行。
   ```bash
   ./run.sh --algo hdbscan --data data/test_data_1k.csv --cores 4
   ./run.sh --algo hdbscan --data data/test_data_2k.csv --cores 4
   ./run.sh --algo hdbscan --data data/test_data_5k.csv --cores 4
   ./run.sh --algo hdbscan --data data/test_data_10k.csv --cores 4
   ```
3. **记录指标**：
   - 记录每次运行的 Phase 1/2/3 耗时：`_spatial_partitioning`, `_build_local_mst`, `_merge_global_mst`。
   - 记录每次运行的**总时间 (Total Time)**，可使用 `phase1 + phase2 + phase3`。
   - 观察控制台输出的边数，例如 `Phase 2 generated ... compressed local/boundary edges` 和 `Global MST built with ... edges`。
4. **绘制数据规模扩展性图**：将记录的时间与边数填入 `scripts/plot_experiment3.py` 开头的 `phase1 / phase2 / phase3 / total / local_edges / global_edges` 数组，然后运行：
   ```bash
   python scripts/plot_experiment3.py
   # → imgs/experiment3_data_scalability_<processor>.png
   ```

### 3.3 预期结论与报告撰写要点
- **作图**：画一张折线图（X轴为数据量 $N$，Y轴为运行时间）。
- **理论对比**：在报告中指出，如果是原始的单机 HDBSCAN，构建完全图需要的边数是 $N \times (N-1) / 2$（例如 $N=20000$ 时，边数近 2 亿条），内存早已溢出，时间复杂度是抛物线级别的指数爆炸。
- **结论**：因为每个 Partition 内部 $O(M^2)$ 的边压缩成了 $M-1$ 棵树枝。从控制台可以看到，哪怕有几万个点，最终在网络中传输并到达 Driver 端的边仅仅只有 $O(N)$ 级别。时间曲线呈现平缓的增长，完美证明了该分布式架构对大规模数据的卓越处理能力。

---

## 实验组 4：真实数据集验证 —— NYC 出租车轨迹 (Real-World Data: NYC Yellow Taxi)

### 4.0 背景说明

合成数据集来自人造点云，而真实数据的挑战截然不同：坐标为经纬度（1° ≈ 111 km），点分布高度不均匀，密集区域（机场、市中心）与稀疏郊区并存。本实验组验证系统的**实用性**，并展示 DBSCAN 与 HDBSCAN 在真实地理数据上的行为差异。

### 4.1 实验目的

1. 验证分布式管道可在真实地理数据上产出有意义的聚类结果。
2. 直观对比不同 `eps` 值对 DBSCAN 的影响，与 HDBSCAN 的自适应优势进行对照。
3. 生成可视化图表（含 OpenStreetMap 地图底图），展示聚类对应的真实地理区域（JFK、时代广场、中央公园等地标）。

### 4.2 数据预处理

从https://www.nyc.gov/site/tlc/about/tlc-trip-record-data.page下载
数据集为2009-01 月份的数据
原始数据为 `.parquet` 格式，需先转换为 x/y（经纬度）列的 CSV：

```bash
# 生成 2000 和 10000 点两个子集
python scripts/preprocess_taxi.py --sizes 2000 10000
```

> **注意**：Taxi 数据坐标为经纬度，合适的 `eps` 范围是 `0.0005 ~ 0.005`（对应约 55 m ~ 550 m），切勿使用合成数据实验中的 `eps=0.3` 或 `eps=1.0`，否则会导致整个数据集被归为一簇。

### 4.3 Step 1：Spark 分布式管道运行

用多个代表性 `eps` 值跑 DBSCAN，加上一次 HDBSCAN，结果自动保存到 `data/` 目录。注意：`eps=0.02` 仅在 2000 点版本中作为“过大半径导致簇过度合并”的定性示例；10000 点版本不运行该设置。

**2000 点版本：**

```bash
# DBSCAN — eps=0.0005 (~55 m)，细粒度，预期出现大量小簇
./run.sh --algo dbscan --data data/taxi_2000.csv --cores 4 --eps 0.0005

# DBSCAN — eps=0.001 (~110 m)，中等粒度，推荐观察值
./run.sh --algo dbscan --data data/taxi_2000.csv --cores 4 --eps 0.001

# DBSCAN — eps=0.002 (~220 m)，粗粒度，预期簇数减少、最大簇变大
./run.sh --algo dbscan --data data/taxi_2000.csv --cores 4 --eps 0.002

# DBSCAN — eps=0.02 (~2.2 km)，极粗粒度，用于展示过大 eps 的合并效应
./run.sh --algo dbscan --data data/taxi_2000.csv --cores 4 --eps 0.02

# HDBSCAN — 自动适应密度，无需手动调 eps
# 注意：Taxi 数据是经纬度坐标，建议显式设置较小的 max_dist 控制 ghost points 范围
./run.sh --algo hdbscan --data data/taxi_2000.csv --cores 4 --max_dist 0.005
```

**10000 点版本：**

```bash
# DBSCAN — eps=0.0005 (~55 m)
./run.sh --algo dbscan --data data/taxi_10000.csv --cores 4 --eps 0.0005

# DBSCAN — eps=0.001 (~110 m)
./run.sh --algo dbscan --data data/taxi_10000.csv --cores 4 --eps 0.001

# DBSCAN — eps=0.002 (~220 m)
./run.sh --algo dbscan --data data/taxi_10000.csv --cores 4 --eps 0.002

# HDBSCAN — 自动适应密度，无需手动调 eps
./run.sh --algo hdbscan --data data/taxi_10000.csv --cores 4 --max_dist 0.005
```

> **为什么 10000 点版本不跑 `eps=0.02`？**  
> `eps=0.02` 在经纬度上约等于 2.2 km。对于 NYC taxi 这种高度集中在曼哈顿、机场和车站附近的真实数据，这个半径会让大量点互相成为邻居，局部 DBSCAN 的邻域图会变得极其稠密。理论上，DBSCAN 的瓶颈是邻域查询和簇扩展；在当前实现中，每个分区内部会构造完整距离矩阵，并在大邻域上执行 Python 层面的 BFS 扩展。当 `eps` 很大时，单个分区内可能出现接近 $O(M^2)$ 的邻接关系和很长的扩展队列，运行时间和内存压力都会明显上升。实际测试中，`taxi_10000 + eps=0.02` 会长时间卡在 Spark action 阶段，因此本实验放弃运行该命令。10000 点版本最终只保留三个 DBSCAN 设置（`0.0005, 0.001, 0.002`）和一个 HDBSCAN 设置。

每次运行会生成形如以下的结果文件（不会互相覆盖）：
- `data/taxi_2000_dbscan_results_eps0.001.csv`
- `data/taxi_2000_dbscan_results_eps0.02.csv`
- `data/taxi_2000_hdbscan_results.csv`
- `data/taxi_10000_dbscan_results_eps0.001.csv`
- `data/taxi_10000_hdbscan_results.csv`

### 4.4 Step 2：可视化

```bash
# sweep 模式：多面板散点图，自动发现 data/ 下的结果文件，快速出图
python scripts/visualize_taxi_spark.py --data data/taxi_2000.csv --mode sweep
# → imgs/spark_sweep_2000.png

# map 模式（可选）：叠加 OpenStreetMap 底图，需联网，首次运行后瓦片缓存至 data/tiles/
python scripts/visualize_taxi_spark.py --data data/taxi_2000.csv --mode map
# → imgs/spark_map_2000.png

# 10000 点版本
python scripts/visualize_taxi_spark.py --data data/taxi_10000.csv --mode sweep
# → imgs/spark_sweep_10000.png

python scripts/visualize_taxi_spark.py --data data/taxi_10000.csv --mode map
# → imgs/spark_map_10000.png
```

### 4.5 预期结论与报告撰写要点

- **2000 点版本**：并排放四张 DBSCAN 图 + 一张 HDBSCAN 图，标注 eps 对应的物理距离（米）。
- **10000 点版本**：并排放三张 DBSCAN 图 + 一张 HDBSCAN 图，不包含 `eps=0.02`。
- **DBSCAN 的困境**：
  - `eps` 偏小 → 机场、广场等真实集散区域内部距离略大于阈值，被整体划为噪声；
  - `eps` 偏大 → 相邻街区的上下客点连片合并，失去地理意义。
- **HDBSCAN 的优势**：无需调参即可同时识别 JFK 机场（密集）和布鲁克林（稀疏但成片）两类截然不同密度的区域，每个簇对应真实的城市功能区。
- **结论**：Taxi 轨迹数据的密度分布与城市结构深度耦合，HDBSCAN 对"变密度"的天然适应性在真实场景下的优越性远比合成数据更为明显。

---

## 5. 最终报告叙事线与局限性说明 (Report Narrative & Limitations)

本项目最终报告不应只呈现“跑通”和“成功”的部分，也应清楚说明当前实现为了适配课程项目规模和 Spark MapReduce 流程所做的简化设计，以及这些简化在真实数据上可能暴露出的局限。推荐报告采用以下叙事结构。

### 5.1 算法实现部分的叙事重点

在算法介绍部分，先完整介绍两个分布式算法实现：

1. **分布式 DBSCAN**
   - 使用 Grid Partitioning 将空间划分为网格。
   - 使用 Ghost Points 复制边界点，缓解跨分区邻域丢失问题。
   - 每个分区内部运行手写 Local DBSCAN。
   - Driver 端使用 Union-Find 合并由共享边界点连接起来的局部簇。

2. **分布式 HDBSCAN-inspired 实现**
   - 使用 KD-Tree 风格的空间划分改善数据倾斜。
   - 使用 `max_dist` 控制 HDBSCAN 中的 soft boundary / ghost point 范围。
   - 在每个分区内部计算局部 core distance、mutual reachability distance (MRD)，并构建 Local MST。
   - 通过 Local MST 压缩将分区内部的候选边从 $O(M^2)$ 降低到接近 $O(M)$。
   - 将 Local MST edges 和 cross-boundary edges 收集到 Driver 端，再构建 Global MST。
   - 在 Driver 端执行简化版 tree condensation 和 cluster extraction。

报告中应明确说明：本项目的 HDBSCAN 是一个 **approximate distributed HDBSCAN-inspired implementation**，而不是工业级严格等价的 HDBSCAN。这个定位非常重要，因为它能解释后续实验 4 中真实数据上的异常现象。

### 5.2 当前 HDBSCAN 实现的简化点

当前实现的核心简化包括：

1. **局部 KNN 近似全局 KNN**
   - 标准 HDBSCAN 的 core distance 应基于全局第 $k$ 近邻。
   - 当前实现只在分区内的 primary + ghost points 上计算局部近邻。
   - 如果重要近邻落在 `max_dist` 覆盖范围之外，core distance 可能偏离真实值。

2. **`max_dist` 软边界截断**
   - HDBSCAN 本身没有 DBSCAN 中的全局 `eps`，但分布式实现需要一个边界复制范围。
   - 当前实现引入 `max_dist` 来限制 ghost points。
   - `max_dist` 太小可能漏掉跨分区连接；太大则会导致 ghost points 和 cross-boundary edges 暴涨，增加内存和运行时间。

3. **Local MST + boundary edges 近似全局 MRD 图**
   - 标准 HDBSCAN 可视为在全局 MRD 完全图上构建 MST。
   - 当前实现只保留每个分区的 Local MST 和跨分区边界边。
   - 这能显著减少通信和 Driver 端压力，但也可能丢掉某些对全局层次结构有影响的候选边。

4. **Global MST 阶段假设候选图足够连通**
   - 当前实现将候选边 collect 到 Driver 后运行 Kruskal。
   - 在合成数据上，候选边通常足以形成覆盖大部分点的全局树。
   - 在真实地理数据上，候选图可能变成多个 disconnected components，即 forest，而不是单一 connected MST。

5. **Tree condensation 是简化实现**
   - 当前 `TreeHierarchy` 主要处理单一 global MST root。
   - 如果输入是 forest，多连通分量的 label propagation 可能不完整。
   - 这可能导致大量点没有被映射到有效簇，最终在 `_assign_labels` 阶段被标记为 `NOISE`。

### 5.3 为什么不实现工业级完整分布式 HDBSCAN

报告中可以说明：实现严格、完整、工业级的分布式 HDBSCAN 难度很高，已经超出本课程项目的合理范围。主要难点包括：

1. **全局 KNN / core distance 计算困难**
   - 严格 HDBSCAN 需要每个点的全局第 $k$ 近邻。
   - 在分布式环境中，准确 KNN 通常需要复杂的空间索引、近似最近邻结构，或高代价的跨分区通信。
   - 如果直接做全局点对比较，复杂度接近 $O(N^2)$，不可扩展。

2. **全局 MRD 图边数过大**
   - MRD 图理论上是完全图，边数为 $N(N-1)/2$。
   - 即使只保存边权，也会造成巨大的内存和网络传输压力。
   - 工业级实现需要复杂的边裁剪、近邻图近似或图压缩策略。

3. **分布式 MST 本身很复杂**
   - 当前项目使用 Driver 端 Kruskal 合并候选边，这是课程项目中可解释、可实现的折中方案。
   - 真正的大规模分布式 MST 往往需要 Borůvka 等分布式图算法。
   - 这涉及多轮 superstep、连通分量压缩、跨分区最小边选择和复杂同步。

4. **完整 condensed tree 和 stability extraction 难以完全手写**
   - HDBSCAN 的 condensed tree 需要正确处理 cluster birth/death、noise falling out、stability propagation、cluster selection 和 label assignment。
   - 多连通分量、重复距离、极小簇、边界点、孤立点等 edge cases 都会影响结果。
   - 工业级库通常包含大量细节处理和数值稳定性设计。

5. **系统工程复杂度高**
   - 需要同时优化 Spark shuffle、partition skew、serialization、Driver memory、cache/spill 行为和任务调度。
   - 对真实数据还要处理坐标尺度、空间分布倾斜和参数敏感性。

因此，本项目选择实现一个可解释的、课程项目规模可运行的 approximate distributed HDBSCAN-inspired pipeline。它的目标不是替代工业级 HDBSCAN 库，而是展示如何将 HDBSCAN 中最核心的图计算思想（MRD + MST + hierarchy）映射到 Spark / MapReduce 风格的分布式流程中。

### 5.4 实验结果部分的叙事安排

推荐最终报告按照以下顺序组织实验结果：

1. **实验 1：合成数据算法效果**
   - 展示 DBSCAN 在不同 `eps` 下的敏感性。
   - 展示 HDBSCAN-inspired 实现在合成变密度数据上的优势。
   - 该实验用于证明算法设计在 controlled synthetic data 上有效。

2. **实验 2：Strong Scaling**
   - 固定 `test_data_10k.csv`，改变 cores。
   - 展示 Phase 2 在 1 到 2 cores 时有明显收益，但 2 到 4 cores 后收益可能变弱。
   - 结合 Spark overhead、M1 Air 硬件限制、内存带宽和 Driver 端串行阶段解释。

3. **实验 3：Data Scalability**
   - 固定 cores，改变数据规模 `1k, 2k, 5k, 10k`。
   - 展示 total runtime、phase time 和 edge counts。
   - 用理论参考线辅助说明实际增长相比 naive complete graph 更可控。

4. **实验 4：真实 Taxi 数据**
   - 先展示 `taxi_2000` 的 sweep/map 图，说明分布式 pipeline 在真实数据上仍能给出可解释的地理聚类结果。
   - 然后展示 `taxi_10000` 的结果，并如实说明两个观察到的限制：
     1. `DBSCAN eps=0.02` 在 10000 点上运行过慢，因此放弃该命令。
     2. HDBSCAN-inspired 实现在 10000 点 taxi 数据上出现接近 100% noise 的结果。

### 5.5 如何解释实验 4 中的两个异常现象

#### 现象 1：`taxi_10000 + DBSCAN eps=0.02` 运行过慢

`eps=0.02` 在经纬度上约等于 2.2 km。对于 NYC taxi 上车点，这个半径会让曼哈顿等高密度区域中的大量点互相成为邻居。DBSCAN 的主要代价来自邻域查询和簇扩展；在当前实现中，每个分区会构造局部完整距离矩阵，并在 Python 层执行 BFS 扩展。当 `eps` 很大时，邻域图会变得非常稠密，单个分区内可能出现接近 $O(M^2)$ 的邻接关系和很长的扩展队列。因此该命令在 10000 点上运行时间过长，最终决定不作为必要实验运行。

#### 现象 2：`taxi_10000` 的 HDBSCAN-inspired 结果接近全噪声

该现象不应解释为 HDBSCAN 理论算法本身失败，而应解释为当前简化分布式实现的局限。具体原因包括：

- Taxi 数据是高度不均匀、空间上多中心的数据集，可能天然形成多个 disconnected spatial components。
- 当前 HDBSCAN-inspired 实现使用 `max_dist` 限制 ghost points 和 cross-boundary edges。
- 当 `max_dist` 较小或数据空间分离明显时，全局候选边可能无法形成单一 connected MST，而是形成多个 disconnected components，即 forest。
- 当前 `TreeHierarchy` 主要假设输入是一棵单 root 的 global MST。
- 如果输入实际是 forest，部分连通分量不会被正确纳入 tree condensation 和 label propagation。
- 最终大量点没有有效 cluster label，在 `_assign_labels` 中被默认映射为 `NOISE`。

因此，`taxi_10000` 中 HDBSCAN-inspired 几乎全噪声的结果，应该作为系统局限性和 future work 来讨论，而不是作为 HDBSCAN 算法失败的结论。

### 5.6 Future Work 可以如何写

可以在报告最后提出以下改进方向：

1. **支持 forest-aware hierarchy extraction**
   - 对 global MST / candidate graph 的每个 connected component 分别执行 tree condensation。
   - 合并各 component 的 labels，避免单 root 假设导致的全噪声问题。

2. **自适应 `max_dist`**
   - 根据数据密度或分区边界点分布动态选择 ghost point 范围。
   - 在减少边界漏连和控制边数膨胀之间取得更好平衡。

3. **更完整的全局 KNN / MRD 近似**
   - 使用分布式近似 KNN 或空间索引减少局部 KNN 偏差。

4. **分布式 MST**
   - 使用 Borůvka 等分布式 MST 算法替代 Driver 端 Kruskal，减少 Driver 瓶颈。

5. **更严格的 HDBSCAN condensed tree 实现**
   - 完善 cluster stability、noise falling out、多连通分量和 label propagation 的 edge cases。
