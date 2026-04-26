# Distributed HDBSCAN & DBSCAN with Apache Spark 实验报告

## 摘要

本项目围绕密度聚类算法在分布式环境中的实现与优化展开，使用 PySpark 从零实现了一个分布式 DBSCAN baseline，以及一个 approximate distributed HDBSCAN-inspired clustering pipeline。项目没有调用 Spark MLlib 或现成聚类库中的黑盒训练接口，而是手动实现了空间划分、边界点复制、局部密度聚类、Union-Find 合并、Mutual Reachability Distance 图构建、Kruskal 最小生成树以及简化版层次树凝缩与稳定簇提取。

项目的核心目标有两个。第一，从机器学习角度验证传统 DBSCAN 在变密度数据上的局限，并展示 HDBSCAN 思想在复杂密度结构上的优势。第二，从分布式系统角度验证如何将 HDBSCAN 中高度依赖全局图结构的计算流程改写为 Spark/MapReduce 风格的多阶段 pipeline。特别地，本项目通过局部 MST 压缩策略，把每个 partition 内的候选图先压缩为局部树结构，再把压缩后的边与跨分区边界边汇总到 Driver 端进行全局合并，从而避免直接构建全局 $O(N^2)$ 完全图。

实验部分包括四组：合成变密度数据上的算法有效性验证、固定数据规模下随 core 数变化的强扩展性实验、固定 core 数下随数据规模变化的数据扩展性实验，以及 NYC Yellow Taxi 真实地理数据实验。结果表明，DBSCAN 对 `eps` 极其敏感，而 HDBSCAN-inspired 方法在合成变密度数据上能更自然地保留不同密度区域；强扩展性实验显示局部图构建阶段能从并行中获益，但 Driver 端全局 MST 合并受到 Amdahl's Law 限制；数据扩展性实验表明系统避免了 naive complete graph 的不可控爆炸，但 cross-boundary candidate edges 和 Driver 合并仍是主要瓶颈；真实 taxi 数据进一步展示了 DBSCAN 参数敏感性，也暴露了当前 approximate HDBSCAN 实现在 forest-aware hierarchy 方面的局限。

## 1. 问题描述

聚类是数据挖掘和机器学习中的基础任务，目标是在没有标签的情况下根据数据点之间的相似性发现潜在结构。密度聚类方法尤其适合空间数据、轨迹数据和异常检测，因为它不要求簇呈球形，也不要求预先指定簇的数量。

DBSCAN 是最经典的密度聚类算法之一。它有三个重要优点：第一，不需要预先指定 cluster 数量；第二，可以发现任意形状的簇；第三，可以显式识别噪声点。DBSCAN 的核心参数是 `eps` 和 `min_samples`。如果一个点在 `eps` 半径内至少拥有 `min_samples` 个邻居，它就是 core point；core point 之间通过密度可达关系扩展成簇；无法被任何簇吸收的点被标记为 noise。

然而，DBSCAN 的主要弱点也来自 `eps`。它使用单一全局距离阈值来定义所有区域的密度，这在 variable-density data 上会出现不可避免的矛盾：如果 `eps` 设得较小，稀疏簇会被误判为噪声；如果 `eps` 设得较大，相邻的密集区域又可能被错误合并。这一问题在真实地理数据中尤为明显，例如纽约出租车上车点在机场、曼哈顿、车站、桥隧附近的密度差异很大，很难用一个固定半径同时描述所有区域。

HDBSCAN 试图解决这一问题。它不依赖单一 `eps`，而是通过 core distance、mutual reachability distance、minimum spanning tree 和 condensed hierarchy 来选择稳定簇。理论上，HDBSCAN 更适合处理不同密度共存的数据结构。但是，标准 HDBSCAN 的计算代价很高：它需要近似或精确的全局 KNN、构建 mutual reachability graph，并在此基础上构造 MST 和层次聚类树。若直接在 $N$ 个点上构建完全图，边数为 $N(N-1)/2$，时间和空间压力都会迅速失控。

因此，本项目的核心问题是：如何在 Spark 中手动实现一个可解释、可运行、具有一定扩展性的分布式密度聚类系统，使其既能体现 DBSCAN/HDBSCAN 的算法思想，又能展示 MapReduce 风格的分布式计算设计。

## 2. 算法描述

### 2.1 DBSCAN baseline

DBSCAN 的基本流程如下：

```text
Input: dataset D, distance threshold eps, density threshold min_samples
Output: cluster label for each point

for each unvisited point p in D:
    mark p as visited
    neighbors = all points within eps of p
    if |neighbors| < min_samples:
        mark p as noise
    else:
        create a new cluster C
        expand C by repeatedly visiting density-reachable neighbors
```

在单机环境中，DBSCAN 的主要瓶颈是邻域查询和簇扩展。朴素实现需要对每个点和其他点做距离比较，复杂度接近 $O(N^2)$。在分布式环境中，问题会更复杂，因为一个点的邻居可能落在另一个 partition 中。如果各 partition 独立运行 DBSCAN，一个跨越 partition 边界的真实簇可能被切成多个局部簇。因此，分布式 DBSCAN 必须同时解决局部计算和跨分区合并两个问题。

本项目中的 Distributed DBSCAN 使用三阶段设计：

1. Grid partitioning：按坐标把空间划分为网格。
2. Ghost points：如果一个点距离网格边界小于 `eps`，则复制到相邻网格。
3. Local DBSCAN + Union-Find merging：每个 partition 内运行手写 DBSCAN，随后 Driver 端根据共享边界点用 Union-Find 合并局部簇。

DBSCAN baseline 的作用是提供一个可解释的对照组，帮助展示固定 `eps` 在变密度数据上的不足。

### 2.2 HDBSCAN 核心思想

HDBSCAN 可以理解为 DBSCAN 的层次化扩展。它的关键概念包括：

Core distance：对每个点 $x$，其 core distance 是到第 $k$ 个近邻的距离，其中 $k$ 对应 `min_samples`。

Mutual reachability distance：

$$
MRD(a,b)=\max(core\_dist(a), core\_dist(b), dist(a,b))
$$

这个定义会把稀疏区域中的点“推远”，从而使不同密度区域在层次结构中更容易被区分。

MST on MRD graph：HDBSCAN 可以视为在所有点构成的 mutual reachability complete graph 上构建 minimum spanning tree。随后通过不断切断较长边得到 single linkage hierarchy。

Condensed tree and stability extraction：HDBSCAN 不选择某个固定距离阈值，而是考察簇在不同密度层级下的生命周期。稳定性更高的簇会被保留，生命周期短或规模过小的结构会被视为噪声或被更稳定的父/子簇替代。

### 2.3 分布式 HDBSCAN-inspired pipeline

严格的工业级分布式 HDBSCAN 很难实现，因为全局 KNN、全局 MRD 图和分布式 MST 都是高复杂度问题。本项目选择实现一个 approximate distributed HDBSCAN-inspired pipeline，目标不是完全复现工业库，而是把 HDBSCAN 中最核心的图计算思想映射到 Spark 计算流程中。

整体流程分为四个阶段：

```text
Input: RDD[(point_id, coordinates)], min_samples, min_cluster_size, max_dist
Output: RDD[(point_id, cluster_label)]

Phase 1: KD-tree spatial partitioning
    sample data on Driver
    build KD-tree-like partition bounds
    assign each point to its primary partition
    replicate points near other partitions as ghost points

Phase 2: Local graph construction
    group points by partition
    compute local distance matrix
    compute local core distances
    compute mutual reachability distances
    build Local MST for primary-primary edges
    retain primary-ghost boundary edges

Phase 3: Global MST merging
    collect local MST edges and boundary edges to Driver
    run Kruskal to build Global MST

Phase 4: Tree condensation and cluster extraction
    build simplified single linkage hierarchy
    condense tree and compute stability
    extract selected clusters
    broadcast labels back to workers
```

这个设计的核心创新是 Local MST compression。标准 HDBSCAN 的 MRD 图理论上是完全图，如果直接传输所有边，网络和 Driver 内存都无法承受。本项目先在每个 partition 内构建局部 MST，使 primary-primary 候选边从 $O(M^2)$ 被压缩到接近 $O(M)$。跨分区的连接则由 primary-ghost boundary edges 补充。这样，最昂贵的距离矩阵和局部图构建被下推到 workers，Driver 只负责在压缩后的候选边集合上进行全局合并。

## 3. Spark 实现细节

### 3.1 项目结构

项目主要模块如下：

```text
core/
  distance.py       # 距离计算与局部距离矩阵
  graph.py          # Union-Find 与 Kruskal MST
  partitioning.py   # GridPartitioner 与 KDTreePartitioner
  spark_utils.py    # Spark 初始化与计时工具

dbscan/
  local_dbscan.py   # 局部 DBSCAN
  distributed.py    # 分布式 DBSCAN 调度逻辑

hdbscan/
  local_graph.py    # 局部 core distance / MRD / Local MST
  distributed.py    # 分布式 HDBSCAN-inspired pipeline
  tree_hierarchy.py # 简化版 tree condensation 与 cluster extraction

scripts/
  generate_data.py
  run_experiment.py
  plot_experiment2.py
  plot_experiment3.py
  visualize.py
  visualize_taxi_spark.py
```

系统入口为 `scripts/run_experiment.py`，它读取 CSV 文件并转换为 RDD：

```text
(point_id, np.array([x, y]))
```

模型输出为：

```text
(point_id, cluster_label)
```

最后结果会与原始 CSV 合并并保存到 `data/` 目录。

### 3.2 Distributed DBSCAN 实现

DBSCAN 使用 `GridPartitioner`。如果没有显式设置 `cell_size`，系统默认使用 `2 * eps`。每个点首先被分配到 primary grid cell；如果该点距离某个 cell boundary 小于 `eps`，它会被复制到相邻 cell，成为 ghost point。ghost point 的作用是让 partition 内局部 DBSCAN 能看到边界附近的邻居，避免跨区簇被直接截断。

每个 partition 内部运行 `LocalDBSCAN`。实现中使用 `scipy.spatial.distance.pdist` 和 `squareform` 构建局部距离矩阵，然后手写 BFS 扩展簇。为了控制局部性，ghost point 可以被动加入簇，但不会主动触发无限跨区扩展。

局部聚类后，Driver 端收集每个点在不同 partition 中所属的 local cluster。如果同一个原始点在多个 partition 中都属于非噪声簇，则这些 local clusters 应被视为同一个 global cluster。系统使用手写 Union-Find 合并这些局部簇，并给每个连通分量分配最终 global cluster id。

### 3.3 Distributed HDBSCAN Phase 1: KD-tree 空间划分

HDBSCAN-inspired pipeline 使用 KD-tree 风格的空间划分。系统先从 RDD 中 sample 至多约 10000 个点，在 Driver 端按维度递归取中位数，构造多个矩形空间边界。相比简单 grid，KD-tree partitioning 更适合不均匀数据，因为它会根据样本分布切分空间，尽量减轻 partition skew。

由于 HDBSCAN 没有 DBSCAN 中固定的 `eps`，边界复制不能直接使用 `eps`。本项目引入 `max_dist` 作为 soft boundary 范围。如果一个点虽然不属于某 partition 的 primary range，但距离该 partition 的矩形边界小于 `max_dist`，它会被复制为 ghost point。这个设计是分布式 HDBSCAN 的工程折中：`max_dist` 过小会漏掉跨区连接，过大则会造成 ghost points 和 boundary edges 膨胀。

### 3.4 Phase 2: 局部 MRD 图与 Local MST

每个 partition 接收 primary points 和 ghost points 后，执行局部图构建。主要步骤包括：

1. 使用向量化距离函数构建局部 pairwise distance matrix。
2. 对每个点取第 `min_samples` 近邻距离作为 local core distance。
3. 使用 $MRD(a,b)=\max(core\_dist(a), core\_dist(b), dist(a,b))$ 构建局部 MRD 权重。
4. 将边分为三类：
   - primary-primary：进入局部图，并用 Kruskal 构建 Local MST。
   - primary-ghost：作为 cross-boundary candidate edge 保留。
   - ghost-ghost：丢弃，因为它们的 primary partition 会负责相关连接。
5. 输出 Local MST edges 与 cross-boundary edges。

这一阶段是整个系统最重要的并行层。局部距离矩阵和局部 MST 构建在各 partition 内独立执行，天然适合 Spark workers 并行。Local MST compression 则减少了从 worker 传回 Driver 的 primary-primary 边数。

### 3.5 Phase 3: Driver 端 Global MST 合并

Phase 3 将 Phase 2 输出的候选边收集到 Driver 端，并使用 Kruskal 构建 Global MST。这个阶段是课程项目规模下合理的工程选择，因为 Local MST 已经对 partition 内部边进行了压缩，Driver 不再面对完整的 $O(N^2)$ MRD 图。

但这一阶段也是系统的天然瓶颈。由于 Kruskal 合并发生在 Driver 端，它不会随着 Spark local cores 增加而明显加速。后续强扩展性实验中可以看到，Phase 3 的耗时基本不随 core 数下降，甚至会因调度和边集合规模波动而略有上升。这正好体现了 Amdahl's Law：一个分布式系统的整体加速上限由不可并行的串行部分决定。

### 3.6 Phase 4: Tree condensation 与 label assignment

Global MST 构建完成后，系统在 Driver 端执行简化版 HDBSCAN hierarchy extraction。实现首先按边权从小到大模拟 single linkage 合并过程，构造一棵层次树；随后自顶向下进行 condensed tree 处理，根据 `min_cluster_size` 判断分裂是否形成有效簇；最后计算 stability 并选择最终簇。

这个模块是手写实现，没有调用 HDBSCAN 库或 scipy hierarchy 高级接口。它足以展示 HDBSCAN 的核心思想，但也是当前实现最需要谨慎解释的部分：当前 `TreeHierarchy` 主要按照单一 global MST root 处理。如果候选图实际上是多个 disconnected components，即 forest，则部分连通分量可能无法被完整纳入 hierarchy 和 label propagation。这一点会在 NYC taxi 10000 数据实验中体现出来。

### 3.7 Spark 层面的优化与计时

项目中使用了几个与 Spark 执行机制相关的优化：

- 使用 `flatMap` 生成 primary point 和 ghost point。
- 使用 `groupByKey` 将同一 partition 的点聚合后进行局部计算。
- 使用 NumPy/SciPy 向量化距离矩阵，避免 Python 双重循环。
- 使用手写 Union-Find 和 Kruskal，避免调用高层 ML 黑盒。
- 对关键 RDD 使用 `persist()`。
- 使用 `count()` 强制触发 action，从而打断 Spark lazy evaluation，使每个 phase 的 `@timeit` 计时更接近真实执行时间。
- Spark 初始化中配置 local cores、driver/executor memory、Kryo serializer 等参数。

## 4. 实验设计与结果分析

本项目实验围绕两个问题展开。第一，算法层面：HDBSCAN-inspired 方法是否比 DBSCAN 更适合变密度数据。第二，系统层面：该 Spark pipeline 是否能随 core 数和数据规模变化表现出可解释的扩展性。

### 4.1 实验一：合成变密度数据上的算法有效性

合成数据由 `scripts/generate_data.py` 生成，包含四类结构：半月形数据、稀疏 Gaussian blobs、极密集小 blob 和随机背景噪声。这个数据集故意制造了不同密度和非凸形状并存的场景，用于观察 DBSCAN 的 `eps` 敏感性。

实验图如下：

<img src="imgs/test_data_2k_dbscan_results_eps0.3.png" alt="DBSCAN eps=0.3" style="zoom:20%;" />

<img src="imgs/test_data_2k_dbscan_results_eps1.0.png" alt="DBSCAN eps=1.0" style="zoom:20%;" />

<img src="imgs/test_data_2k_hdbscan_results.png" alt="Distributed HDBSCAN" style="zoom:20%;" />

从 `data/test_data_2k_dbscan_results_eps0.3.csv` 的统计看，DBSCAN 在 `eps=0.3` 时产生 31 个 clusters，噪声点为 626 个，占 31.3%。结合图像可以看到，小 `eps` 能较好保留两个半月形结构和部分密集 blob，但右上角稀疏区域被切成许多小簇，并且大量稀疏点变成灰色 noise。这说明小半径对密集结构友好，却难以覆盖稀疏簇中的点间距离。

当 `eps=1.0` 时，DBSCAN 只产生 4 个 clusters，噪声点下降到 37 个，占 1.8%。但这不是更好的聚类结果。图中绝大多数点被合并进一个巨大的 `GlobalCluster_0`，该最大簇包含 1931 个点，占全部数据的 96.5%。它把半月形、稀疏 blobs、密集 blob 以及中间连接区域几乎全部粘在一起，丢失了原本的多结构信息。这正是 DBSCAN 在 variable-density data 上的典型失败模式：为了覆盖稀疏簇而增大 `eps`，会导致不同簇被过度合并。

HDBSCAN-inspired 结果产生 42 个 clusters，噪声点为 482 个，占 24.1%。图中两个半月形结构仍然被清晰保留，极密集小 blob 也被识别出来；与此同时，稀疏区域不再像 `eps=0.3` 那样被大面积丢弃，也不像 `eps=1.0` 那样被全部吞并进一个大簇。它仍然存在一定碎片化，说明当前实现是 approximate pipeline，而不是工业级 HDBSCAN；但从整体结构上看，它比固定 `eps` 的 DBSCAN 更好地兼顾了不同密度区域。

因此，实验一的结论是：DBSCAN 的表现高度依赖 `eps`，小 `eps` 导致稀疏簇噪声化，大 `eps` 导致簇过度合并；HDBSCAN-inspired 方法通过 MRD、MST 和 stability 思想减少了对单一距离阈值的依赖，在合成变密度数据上展示出更稳健的结构保留能力。

### 4.2 实验二：强扩展性实验

强扩展性实验固定数据集为 `test_data_10k.csv`，改变 Spark local cores 数量为 1、2、4，观察总时间和各 phase 时间。实验分别在 Intel Core i7 和 Apple M1 上记录。图表如下：

![Strong Scaling Intel Core i7](imgs/experiment2_strong_scaling_intel_core_i7.png)

![Strong Scaling Apple M1](imgs/experiment2_strong_scaling_apple_m1.png)

Intel Core i7 的具体数值如下：

| Cores | Phase 1 Spatial Partitioning | Phase 2 Local MST | Phase 3 Global MST | Total | Speedup |
|---:|---:|---:|---:|---:|---:|
| 1 | 9.4157s | 202.6561s | 118.8170s | 330.8888s | 1.000x |
| 2 | 6.3747s | 130.7947s | 119.9011s | 257.0705s | 1.287x |
| 4 | 4.4397s | 120.7852s | 126.7119s | 251.9368s | 1.313x |

Apple M1 的具体数值如下：

| Cores | Phase 1 Spatial Partitioning | Phase 2 Local MST | Phase 3 Global MST | Total | Speedup |
|---:|---:|---:|---:|---:|---:|
| 1 | 28.8406s | 94.2808s | 45.2292s | 168.3506s | 1.000x |
| 2 | 15.7653s | 51.9486s | 44.4981s | 112.2120s | 1.500x |
| 4 | 9.2194s | 48.3827s | 52.8582s | 110.4603s | 1.524x |

两组硬件都显示出相同趋势：从 1 core 增加到 2 cores 时，总时间明显下降；从 2 cores 增加到 4 cores 时，收益变小。i7 上总时间从 330.89s 降至 257.07s，再降至 251.94s；M1 上总时间从 168.35s 降至 112.21s，再降至 110.46s。实际 speedup 明显低于理想线性加速，4 cores 时 i7 只有 1.313x，M1 只有 1.524x。

从 phase breakdown 可以看出原因。Phase 2 是局部图构建与 Local MST 阶段，最符合 embarrassingly parallel 的特征。i7 上 Phase 2 从 202.66s 降到 130.79s，再到 120.79s；M1 上从 94.28s 降到 51.95s，再到 48.38s。增加 core 数确实能降低局部计算时间，但 2 到 4 cores 的边际收益明显减弱。这可能来自 Spark local mode 调度开销、Python worker 开销、内存带宽限制以及 partition 粒度不足。

Phase 3 则表现出完全不同的趋势。i7 上 Phase 3 从 118.82s 到 119.90s，再到 126.71s，几乎没有下降；M1 上 Phase 3 从 45.23s 到 44.50s，再到 52.86s，也没有随 core 数增加而改善。原因是当前实现把候选边 collect 到 Driver 后，在 Driver 端串行运行 Kruskal 构建 Global MST。这个阶段不是 worker 并行计算，因此增加 Spark cores 不会显著加速它。

这一结果很好地体现了 Amdahl's Law。系统中可并行的 Phase 2 能从更多 cores 中获益，但不可并行的 Phase 3 限制了整体 speedup。当 core 数增加后，Phase 3 在总时间中的占比上升，成为更明显的瓶颈。因此，本实验既证明了局部图构建的并行化有效，也揭示了 Driver-side global merge 是当前架构的主要扩展性上限。

### 4.3 实验三：数据规模扩展性实验

数据规模实验固定 cores 为 4，使用合成数据 `1k, 2k, 5k, 10k`，观察总运行时间、各 phase 时间以及边数变化。图表如下：

![Data Scalability Intel Core i7](imgs/experiment3_data_scalability_intel_core_i7.png)

![Data Scalability Apple M1](imgs/experiment3_data_scalability_apple_m1.png)

Intel Core i7 的时间数据如下：

| N | Phase 1 | Phase 2 | Phase 3 | Total |
|---:|---:|---:|---:|---:|
| 1,000 | 5.3051s | 6.2394s | 1.1684s | 12.8308s |
| 2,000 | 3.5601s | 8.0128s | 4.0899s | 16.0686s |
| 5,000 | 3.7330s | 31.2422s | 29.0258s | 66.3525s |
| 10,000 | 5.1078s | 122.2111s | 142.3687s | 280.5226s |

Apple M1 的时间数据如下：

| N | Phase 1 | Phase 2 | Phase 3 | Total |
|---:|---:|---:|---:|---:|
| 1,000 | 8.4817s | 9.0491s | 0.3433s | 17.9190s |
| 2,000 | 8.6358s | 8.8961s | 1.2368s | 18.9187s |
| 5,000 | 8.7653s | 14.7318s | 9.5790s | 33.9932s |
| 10,000 | 9.2916s | 50.1126s | 54.9087s | 118.0327s |

从总时间看，随着数据从 1k 增长到 10k，i7 总时间从 12.83s 增长到 280.52s，约为 21.86 倍；M1 从 17.92s 增长到 118.03s，约为 6.59 倍。增长并非线性，但相比 naive complete graph 的 $O(N^2)$ 直接构建，系统仍然保留了可运行性。以 10k 数据为例，全局完全图边数理论上为：

$$
\frac{10000 \times 9999}{2}=49,995,000
$$

如果直接在 Driver 端构建完整 MRD 图，内存和排序代价都会非常高。本项目没有把完整图直接传到 Driver，而是先在 partitions 内执行局部图构建和 Local MST 压缩。

边数统计如下：

| N | Phase 2 Output Candidate Edges | Global MST Edges |
|---:|---:|---:|
| 1,000 | 241,346 | 999 |
| 2,000 | 986,906 | 1,999 |
| 5,000 | 6,109,519 | 4,999 |
| 10,000 | 24,516,479 | 9,999 |

这里需要仔细解释。`Global MST Edges` 始终为 $N-1$，这说明最终全局树结构被压缩到了线性规模。但 `Phase 2 Output Candidate Edges` 仍然增长很快，10k 时达到 24.52M。这些 candidate edges 不只是 local MST edges，还包括 primary-ghost cross-boundary edges。由于 HDBSCAN 没有固定 `eps`，当前实现用 `max_dist` 控制 soft boundary。当 `max_dist` 覆盖范围较大或 partition 边界附近点较多时，cross-boundary edges 会显著膨胀。因此，Local MST compression 有效控制了 partition 内 primary-primary 边，但 boundary edges 仍然可能成为规模扩展时的重要压力源。

Phase 2 和 Phase 3 的变化也证明了这一点。i7 上 Phase 2 从 6.24s 增长到 122.21s，约 19.59 倍；Phase 3 从 1.17s 增长到 142.37s，约 121.86 倍。M1 上 Phase 2 从 9.05s 增长到 50.11s，约 5.54 倍；Phase 3 从 0.34s 增长到 54.91s，增长幅度更大。随着数据规模扩大，Driver 端需要排序和合并的 candidate edge 数量迅速增加，导致 Phase 3 从小规模时的轻量步骤逐渐变成主要瓶颈。

因此，实验三的结论是双重的。一方面，系统确实避免了直接构造全局完全图，使 10k 级别 HDBSCAN-inspired pipeline 能够在本地 Spark 环境运行，并最终生成 $N-1$ 规模的 Global MST。另一方面，cross-boundary candidate edges 和 Driver 端 Kruskal 合并仍然是扩展性限制。这个结果比单纯宣称“线性扩展”更真实，也更符合分布式系统实验应有的观察：优化一个瓶颈后，新的瓶颈会在更大规模下显现出来。

### 4.4 实验四：NYC Yellow Taxi 真实数据实验

真实数据使用 NYC Yellow Taxi pickup coordinates，实验规模为 2000 和 10000 个点。该数据与合成数据不同，坐标是经纬度，点分布高度不均匀，曼哈顿、机场和交通枢纽附近明显更密集。因此，实验重点不是追求某个“唯一正确”的聚类标签，而是观察不同算法和参数如何解释真实空间分布。

2000 点结果如下：

![NYC Taxi 2000 Sweep](imgs/spark_sweep_2000.png)

10000 点结果如下：

![NYC Taxi 10000 Sweep](imgs/spark_sweep_10000.png)

地图底图版本如下：

![NYC Taxi 2000 Map](imgs/spark_map_2000.png)

![NYC Taxi 10000 Map](imgs/spark_map_10000.png)

#### 4.4.1 Taxi 2000 结果

Taxi 2000 的统计如下：

| Method | Clusters | Noise | Noise Ratio | Largest Cluster |
|---|---:|---:|---:|---:|
| DBSCAN eps=0.0005 | 39 | 1780 | 89.0% | 21 |
| DBSCAN eps=0.001 | 102 | 1051 | 52.5% | 51 |
| DBSCAN eps=0.002 | 23 | 261 | 13.1% | 1469 |
| DBSCAN eps=0.02 | 2 | 11 | 0.5% | 1966 |
| HDBSCAN-inspired | 126 | 676 | 33.8% | 42 |

从 sweep 图可以看到，`eps=0.0005` 约对应 55m，半径过小，大多数点被标为噪声，只剩下少量极局部的小簇。这说明在真实城市数据中，即使同属一个功能区域，pickup points 之间的距离也常常超过 55m。

当 `eps=0.001` 约 111m 时，噪声比例下降到 52.5%，簇数上升到 102。图中曼哈顿主要带状区域开始出现较多彩色簇，但仍有大量灰色点。这个设置比 55m 更能捕捉局部街区结构，但仍偏碎。

当 `eps=0.002` 约 222m 时，噪声比例进一步下降到 13.1%，但最大簇达到 1469 个点，占 73.5%。图中曼哈顿主区域被一个大簇占据，说明 DBSCAN 开始把相邻街区连续连接起来。它减少了噪声，却牺牲了地理区分度。

`eps=0.02` 约 2.2km，是一个故意设置的过大半径。结果几乎所有点都被合并进一个巨大簇，最大簇包含 1966 个点，占 98.3%。这非常直观地展示了 DBSCAN 的过度合并问题：当半径大到城市街区尺度时，密集区域会通过连续邻域链条连成一片，聚类结果失去实际解释意义。

HDBSCAN-inspired 在 2000 点上产生 126 个 clusters，噪声比例为 33.8%，最大簇只有 42 个点。图中它没有像 `eps=0.002` 或 `eps=0.02` 那样把曼哈顿主区域吞并成单一大簇，而是保留了许多较小的局部结构。这个结果说明 HDBSCAN-inspired 方法在真实数据上确实减少了单一半径带来的过度合并问题。不过，它也产生了较多小簇，反映出当前 approximate hierarchy extraction 对真实地理数据仍偏碎片化。

#### 4.4.2 Taxi 10000 结果

Taxi 10000 的统计如下：

| Method | Clusters | Noise | Noise Ratio | Largest Cluster |
|---|---:|---:|---:|---:|
| DBSCAN eps=0.0005 | 366 | 2756 | 27.6% | 314 |
| DBSCAN eps=0.001 | 71 | 780 | 7.8% | 7906 |
| DBSCAN eps=0.002 | 21 | 389 | 3.9% | 9215 |
| HDBSCAN-inspired | 1 | 9998 | 100.0% | 2 |

10000 点结果进一步放大了 DBSCAN 的参数敏感性。`eps=0.0005` 时产生 366 个 clusters，噪声比例 27.6%。由于点数增加，55m 半径已经能在曼哈顿高密度区域形成许多局部簇，但图中仍存在大量灰色点。

`eps=0.001` 时，噪声比例下降到 7.8%，但最大簇达到 7906 个点，占 79.1%。从图中可以看到，大量曼哈顿区域已经被同一个主簇连接。`eps=0.002` 时这一趋势更明显，最大簇达到 9215 个点，占 92.2%，clusters 数下降到 21。也就是说，随着数据密度增加，同一个 `eps` 更容易通过密集邻域链条连接成巨大簇。DBSCAN 的结果不仅依赖 `eps`，也强烈依赖采样密度。

HDBSCAN-inspired 在 10000 点 taxi 数据上出现了接近全噪声的结果：9998 个点被标为 `NOISE`，只有 2 个点进入一个 cluster。这个现象不能解释为 HDBSCAN 理论算法失败，而应该解释为当前 approximate distributed implementation 的局限。

根据代码结构，当前 HDBSCAN-inspired pipeline 依赖 `max_dist` 生成 ghost points 和 cross-boundary edges，并假设 Phase 3 形成的 Global MST 能够支撑一个相对完整的 single-root hierarchy。但真实 taxi 数据高度不均匀，并且在地理上存在多中心分布。候选图很可能不是一棵连通的 MST，而是多个 disconnected components 组成的 forest。当前 `TreeHierarchy` 主要按单 root 处理 hierarchy；如果输入实际上是 forest，部分连通分量无法完整参与 tree condensation 和 label propagation，最终会在 `_assign_labels` 中因为没有有效 label 而被标为 `NOISE`。

此外，10000 点版本没有运行 `eps=0.02` 的 DBSCAN 对照。原因是 `eps=0.02` 在经纬度上约等于 2.2km，对于曼哈顿这种高密度区域会产生极其稠密的邻域图。当前 DBSCAN 实现会在每个 partition 内构造局部距离矩阵，并用 Python 层 BFS 扩展簇。当 `eps` 过大时，邻接关系接近 $O(M^2)$，扩展队列也会变长，因此运行时间和内存压力都会显著增加。2000 点实验已经足够展示 `eps=0.02` 的过度合并效果，10000 点不继续运行是合理的实验取舍。

## 5. 综合讨论与局限性

### 5.1 算法复杂度与并行化价值

本项目实现的算法比普通 DBSCAN baseline 更复杂。它不仅包括分布式空间划分和局部聚类，还实现了 HDBSCAN 中的 core distance、mutual reachability distance、MST、single linkage hierarchy 和 stability extraction。更重要的是，项目没有直接调用现成 HDBSCAN 库，而是将这些算法组件拆解到 Spark pipeline 中。

并行化的主要新颖性在于 Local MST compression。HDBSCAN 的困难在于全局 MRD 图过大，而本项目将图计算下推到 partitions：先在局部计算距离矩阵和 MRD，再用 Local MST 压缩 primary-primary 边，最后仅把压缩边和 boundary edges 汇总。这个设计体现了 MapReduce 中 push-down computation 的思想：尽可能把重计算留在 worker 本地，把需要 shuffle 或 collect 的数据规模降下来。

实验二证明 Phase 2 能从多 core 中受益，实验三证明系统能在 1k 到 10k 数据规模上运行，而不是直接被全局完全图卡住。这说明该并行化设计是有效的。

### 5.2 Driver 端瓶颈与 Amdahl's Law

当前系统最明显的瓶颈是 Phase 3。强扩展性实验中，Phase 3 几乎不随 core 数增加而下降；数据扩展性实验中，Phase 3 随 candidate edge 数量迅速增长，在 10k 数据上已经成为主要耗时之一。

这说明 Driver-side Kruskal 是一个明确的串行瓶颈。课程项目规模下，这一设计有两个优点：实现清晰，便于解释；在 10k 级别数据上仍可运行。但是从系统扩展角度，它限制了更大规模的数据处理能力。如果要进一步扩大规模，需要考虑把全局 MST 合并也分布式化，例如使用 Boruvka 类图算法，或先对 candidate graph 做更强的分层压缩。

### 5.3 `max_dist` 与 boundary edges 的权衡

HDBSCAN 没有 DBSCAN 的 `eps`，因此分布式边界复制必须引入额外参数。本项目使用 `max_dist` 控制 ghost point 复制范围。这个参数本质上是一个工程折中：

- 如果 `max_dist` 太小，跨分区连接可能缺失，candidate graph 容易断裂成 forest。
- 如果 `max_dist` 太大，ghost points 和 primary-ghost boundary edges 会迅速增加，Phase 2 输出边数和 Phase 3 合并压力都会上升。

实验三中的 candidate edge 数量已经体现了这个问题。虽然 Global MST 最终只有 $N-1$ 条边，但 10k 数据下 Phase 2 output candidate edges 达到 24.52M。说明 boundary edges 是当前实现中必须认真讨论的扩展性成本。

### 5.4 Approximate HDBSCAN-inspired 实现的定位

本项目中的 HDBSCAN 应被准确表述为 approximate distributed HDBSCAN-inspired implementation，而不是严格等价于工业 HDBSCAN 的完整实现。主要简化包括：

1. Core distance 基于 partition-local primary + ghost points，而不是严格全局 KNN。
2. MRD 图不是完整全局完全图，而是 Local MST edges 加 cross-boundary edges 的候选图。
3. Global MST 假设候选图足够连通，但真实数据上可能形成 forest。
4. Tree condensation 是简化手写版本，对多连通分量、重复距离、复杂 label propagation 等 edge cases 处理有限。

这种定位并不是削弱项目贡献，而是让实验分析更可信。项目的价值在于展示如何将 HDBSCAN 的核心思想工程化地映射到 Spark/MapReduce，而不是声称已经替代成熟工业库。

### 5.5 真实数据实验暴露的问题

Taxi 10000 中 HDBSCAN-inspired 近似全噪声，是报告中必须诚实解释的现象。它说明当前实现对真实、高度不均匀、多中心数据的 forest 情况处理不足。这一结果反而有助于体现系统分析深度：分布式算法不只是“跑出图”，更要解释什么时候会失败，以及失败来自理论算法、工程近似还是实现假设。

对于本项目，失败主要来自工程近似和 hierarchy 实现假设，而不是 HDBSCAN 理论本身。只要把每个 connected component 分别做 hierarchy extraction，或改进 global candidate graph 的连通性，真实数据上的 HDBSCAN-inspired 结果仍有改进空间。这里不单独展开未来工作章节，但这一点可以作为当前系统局限性的自然结论。

## 6. 结论

本项目完成了一个从零实现的 Spark 分布式密度聚类系统，包括 Distributed DBSCAN baseline 和 Distributed HDBSCAN-inspired pipeline。DBSCAN 部分通过 grid partitioning、ghost points 和 Union-Find merging 解决了局部聚类与跨分区合并问题；HDBSCAN-inspired 部分进一步实现了 KD-tree partitioning、local core distance、mutual reachability distance、Local MST compression、Global MST merging 和简化版 tree condensation。

从算法实验看，DBSCAN 在合成变密度数据上表现出明显的 `eps` 敏感性：小 `eps` 导致稀疏区域噪声化，大 `eps` 导致多个结构被吞并成大簇。HDBSCAN-inspired 方法虽然不是工业级完整实现，但能更好地保留不同密度区域，减少对单一距离阈值的依赖。

从系统实验看，Phase 2 局部图构建能随 core 数增加获得加速，说明计算下推和 partition-local graph construction 是有效的；但 Phase 3 Driver-side Global MST 合并不随 core 数加速，体现了 Amdahl's Law 下的串行瓶颈。数据规模实验进一步显示，Local MST 和 Global MST 能把最终树结构压缩到 $O(N)$，但 cross-boundary candidate edges 仍会快速增长，是后续扩展性的关键限制。

从真实数据实验看，NYC taxi 数据清楚展示了 DBSCAN 在地理数据上的参数敏感性，也暴露了当前 approximate HDBSCAN-inspired 实现在多连通分量和真实空间分布上的不足。整体而言，本项目不仅实现了一个可运行的分布式聚类系统，也通过实验展示了分布式算法设计中的核心权衡：并行化、通信成本、Driver 瓶颈、边界复制和算法近似之间必须共同考虑。

## 7. 源代码说明

本项目源代码作为独立文件提交，主要文件包括：

```text
core/distance.py
core/graph.py
core/partitioning.py
core/spark_utils.py
dbscan/local_dbscan.py
dbscan/distributed.py
hdbscan/local_graph.py
hdbscan/distributed.py
hdbscan/tree_hierarchy.py
scripts/generate_data.py
scripts/run_experiment.py
scripts/plot_experiment2.py
scripts/plot_experiment3.py
scripts/visualize.py
scripts/visualize_taxi_spark.py
```

报告正文只展示核心算法思想和实验结果，完整实现见上述源代码文件。

## 8. 参考资料

1. Ester, M., Kriegel, H. P., Sander, J., & Xu, X. (1996). A density-based algorithm for discovering clusters in large spatial databases with noise. Proceedings of KDD.
2. Campello, R. J. G. B., Moulavi, D., & Sander, J. (2013). Density-Based Clustering Based on Hierarchical Density Estimates. PAKDD.
3. McInnes, L., Healy, J., & Astels, S. (2017). hdbscan: Hierarchical density based clustering. Journal of Open Source Software.
4. Apache Spark Documentation: RDD Programming Guide and PySpark API.
5. Kruskal, J. B. (1956). On the shortest spanning subtree of a graph and the traveling salesman problem. Proceedings of the American Mathematical Society.
6. NYC Taxi & Limousine Commission Trip Record Data.
