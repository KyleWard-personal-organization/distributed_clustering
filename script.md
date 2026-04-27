# PPT Presentation Script

> 说明：这份讲稿与当前 27 页 PPT 对齐。每一页都包含建议讲述内容和自然衔接语。正式演讲时可以按时间压缩，重点保留每页的第一段和最后一句过渡。

---

## Slide 1 — Distributed HDBSCAN & DBSCAN

大家好，我们这次 deep project 的题目是 **Distributed HDBSCAN & DBSCAN with Apache Spark**。项目的核心不是简单调用一个现成聚类库，而是从底层实现密度聚类算法，并把其中最重的图计算部分改写成 Spark 可以执行的分布式 pipeline。

这个项目同时有两个视角。第一个是机器学习视角：为什么 DBSCAN 在变密度数据上会失败，HDBSCAN 思想为什么更适合这类数据。第二个是分布式系统视角：HDBSCAN 依赖 KNN、MRD graph 和 MST，这些本来是非常全局的计算，我们如何通过 partition、ghost points、local MST compression 和 driver-side merge 把它映射到 Spark。

接下来先看整个 presentation 的路线。

---

## Slide 2 — Presentation Roadmap

今天的汇报分成五个部分。第一部分是 introduction，说明问题背景和项目目标。第二部分是 algorithm overview，介绍 DBSCAN、HDBSCAN 以及它们在分布式场景下的挑战。第三部分是 Spark implementation，重点讲系统如何把算法拆成 RDD pipeline。第四部分是 experiments and discussion，会展示合成数据、scaling 实验和 NYC taxi 真实数据结果。最后是 conclusion。

这条主线其实可以概括成一句话：**variable density meets distributed graph computation**。也就是说，我们既要解决聚类质量问题，也要解决图计算扩展性问题。

接下来进入第一部分，先看为什么这个问题值得做。

---

## Slide 3 — Introduction

这一节是背景动机。密度聚类本身很有吸引力，因为它不要求预先指定 cluster 数量，可以发现任意形状的簇，也可以把异常点标记为 noise。

但它的问题也很明显：传统 DBSCAN 依赖一个全局 `eps`。当数据里同时存在密集区域和稀疏区域时，一个固定半径很难同时适配所有区域。这正是我们引入 HDBSCAN 思想的原因。

下一页我会把这个 tension 更具体地画出来。

---

## Slide 4 — Problem Background

这页展示的是项目的问题背景。左边是 density clustering 的目标：我们希望从点云里自动发现任意形状的区域，同时识别 noise。中间是 DBSCAN 的核心困难：固定的 `eps` 在变密度数据上会出现两种相反错误。`eps` 太小，稀疏区域被当成 noise；`eps` 太大，相邻区域被过度合并。

右边是这个项目的系统挑战。HDBSCAN 用 density hierarchy 替代单一 `eps`，但它引入了更重的图计算：core distance、mutual reachability distance、MST 和 hierarchy extraction。这些计算在单机上已经很重，在 Spark 中还要处理 partition boundary、ghost points 和 global merge。

所以本项目的核心问题是：能否手动实现一个可解释的分布式密度聚类系统，同时体现 DBSCAN/HDBSCAN 的算法思想和 Spark/MapReduce 的分布式设计。

接下来看看项目具体要完成什么。

---

## Slide 5 — Project Objective

项目目标可以分成三部分。第一，我们实现一个 distributed DBSCAN baseline，它包含 grid partitioning、ghost points、local DBSCAN 和 Union-Find merge。第二，我们实现一个 HDBSCAN-inspired distributed pipeline，包括 KD-tree partitioning、local MRD graph、Local MST compression、Global MST 和简化版 hierarchy extraction。第三，我们通过实验验证算法质量和系统扩展性。

这里有一个很重要的课程要求：我们不能只是调用 Spark MLlib 或现成 HDBSCAN 库。这个项目里的空间划分、距离矩阵、Union-Find、Kruskal MST、RDD transformations 和 phase timing 都是手动实现或显式组织的。

有了目标之后，第二部分进入算法设计。

---

## Slide 6 — Algorithm Overview

算法部分的主线是从固定半径的 density rule 走向 graph-based density hierarchy。我们先看 DBSCAN，因为它是最直观的密度聚类 baseline；然后看为什么 fixed `eps` 会失败；最后再看 HDBSCAN 如何通过 core distance、MRD、MST 和 stability 来减少对单一阈值的依赖。

需要注意的是，我们讲 DBSCAN 不是为了停留在单机算法，而是为了说明它在分布式环境中需要哪些额外机制。

下一页先看 distributed DBSCAN baseline。

---

## Slide 7 — Distributed DBSCAN Baseline

在每个 Spark partition 内，DBSCAN 仍然使用经典的 `eps / minPts` 规则：一个点如果在 `eps` 半径内有足够邻居，就是 core point；cluster 通过 density-connected relationship 扩展。

分布式难点在于，一个点的邻居可能在另一个 partition 里。如果只在每个 partition 内独立运行 DBSCAN，一个真实跨边界 cluster 会被切成多个 local clusters。所以我们的 baseline 流程是：先 grid partition，再复制 boundary ghost points，然后在每个 partition 内跑 local DBSCAN，最后用 Union-Find 在 Driver 端合并跨区连接的 local clusters。

这页的重点是：DBSCAN 本身规则简单，但分布式正确性来自 ghost points 和 global label reconciliation。

接下来用真实实验图看 fixed `eps` 的失败模式。

---

## Slide 8 — Fixed eps Creates Opposite Failure Modes

这页展示合成变密度数据上的两个 DBSCAN 对照结果。左边 `eps = 0.3` 时，小半径可以保留部分密集结构，但大量稀疏区域被切碎或标记为 noise，噪声比例达到 31.3%。右边 `eps = 1.0` 时，noise 变少了，但 96.5% 的点被合并进一个巨大 cluster。

这说明 DBSCAN 的核心问题不是参数没有调好，而是单一全局半径本身不适合变密度数据。为了覆盖稀疏区域而增大 `eps`，会把不同结构粘在一起；为了保护密集结构而减小 `eps`，又会丢掉稀疏簇。

这正是 HDBSCAN 思想进入项目的动机。

---

## Slide 9 — HDBSCAN Replaces eps with Density Hierarchy

HDBSCAN 不再问“两个点是否在同一个 fixed eps 半径内”，而是先计算每个点的 core distance，再定义 mutual reachability distance，也就是 `MRD(a,b) = max(core(a), core(b), dist(a,b))`。这个距离会把稀疏区域中的连接拉长，从而更自然地区分不同密度结构。

之后，HDBSCAN 在 MRD graph 上构建 MST，并根据边权形成 hierarchy。最终不是选择某个固定距离阈值，而是根据 cluster 在不同密度层级下的 stability 来选择稳定簇。

从单机角度看，这是 global KNN、MRD graph、MST 和 hierarchy 的算法链条；从分布式角度看，挑战是这些对象都很全局。因此我们的实现采用 local KNN/MRD、Local MST compression 和 driver-side merge 的近似 pipeline。

下一页看这个 pipeline 的完整设计。

---

## Slide 10 — Distributed HDBSCAN-Inspired Pipeline

这页是整个系统的核心算法结构。Phase 1 在 Driver 端构建 KD-tree 风格的空间划分，并通过 ghost points 处理 soft boundary。Phase 2 是 worker-local 的核心并行层：每个 partition 内计算 local MRD graph，并用 Kruskal 构建 Local MST。Phase 3 把 compressed edges collect 到 Driver，在 Driver 端构建 Global MST。Phase 4 再做 condensed tree 和 label assignment。

设计原则是：**expensive graph construction local，compressed connectivity evidence global**。也就是说，最重的距离矩阵和局部图构建尽量下推到 worker，传回 Driver 的不是完整 MRD complete graph，而是 Local MST edges 和 boundary edges。

下面进入 Spark implementation，看这些算法步骤如何落到 RDD 操作和代码模块上。

---

## Slide 11 — Spark Implementation

这一节把算法设计翻译成 Spark 执行过程。我们重点看 Driver 和 workers 各自负责什么、RDD transformation 如何组织、以及哪些地方是系统瓶颈。

这里需要强调一点：这个项目不仅是算法实现，也是分布式执行计划。比如 `flatMap` 用于 ghost point replication，`groupByKey` 用于按 partition 聚合，`persist + count` 用于触发 action 和记录真实 phase time，`collect` 是 driver-side global merge 的关键瓶颈，`broadcast` 用于把最终 labels 发回 workers。

下一页看系统架构。

---

## Slide 12 — System Architecture

这页展示 Driver 和 Spark workers 的职责划分。左侧 Driver 先 sample data，构建 KD-tree partition rules，然后把这些 rules broadcast 给 workers。中间 workers 并行执行 partition-local MRD 和 Local MST。右侧 Driver 收集 compressed edges，构建 Global MST，并完成 label extraction。

下方是 RDD execution path：`flatMap` 负责 ghost point replication，`groupByKey` 把同一个 partition 的点收集到一起，`persist + count` 用于 materialize RDD 和计时，`collect` 把压缩边带回 Driver，最后 `broadcast` 发送最终 labels。

这页的重点是，Spark 并不是自动解决所有问题。我们通过 RDD pipeline 明确地把可并行和不可并行的部分分开了。

接下来具体看 boundary 问题，也就是 ghost points。

---

## Slide 13 — Soft Boundary with Ghost Points

如果 partition boundary 是硬切分，那么靠近边界的邻居关系会被截断。对于 DBSCAN，这会导致一个跨边界 cluster 被拆开；对于 HDBSCAN-inspired pipeline，这会导致 MRD graph 缺少关键跨区连接。

所以我们使用 ghost points 建立 soft overlap band。DBSCAN 中 overlap radius 可以直接用 `eps`；HDBSCAN 没有 fixed `eps`，因此我们引入 `max_dist` 控制边界复制范围。一个 near-boundary point 可以作为 ghost copy 出现在相邻 partition 中，让两个 worker 都能看到这个局部邻域。

这个设计是工程折中：`max_dist` 太小会漏掉跨区连接，太大会产生过多 ghost points 和 boundary edges。

下一页看为什么 Local MST compression 是系统中最重要的优化。

---

## Slide 14 — Local MST Compression

在一个 partition 内，如果我们直接保留所有 MRD edges，边数是 `O(M^2)`。这对通信和 Driver 内存都不友好。我们的做法是在 worker 内部先运行 Kruskal，把 primary-primary 的局部候选边压缩成 Local MST skeleton。

左边表示 local MRD graph，边比较密；右边表示 Local MST，只保留连接结构所需的骨架边。这样 primary-primary edges 从 `O(M^2)` 降到大约 `M - 1`。跨区的 primary-ghost boundary edges 则单独保留，用于后续全局连通。

这一步就是 MapReduce push-down 的体现：重计算在 worker 本地完成，Driver 只接收 compressed edges。

下一页把这些实现映射到代码文件。

---

## Slide 15 — Implementation Map

这页是代码结构地图。`core/partitioning.py` 负责 grid 和 KD-tree partitioners，以及 ghost points。`dbscan/local_dbscan.py` 实现局部距离矩阵和 BFS cluster expansion。`dbscan/distributed.py` 负责 partition、local DBSCAN 和 Union-Find merge。

HDBSCAN 部分中，`hdbscan/local_graph.py` 负责 core distance、MRD 和 Local MST；`hdbscan/distributed.py` 组织 4-phase pipeline；`hdbscan/tree_hierarchy.py` 执行简化版 condensation 和 stability labels。底层的 Union-Find 和 Kruskal MST 在 `core/graph.py` 中复用。

这说明项目符合 deep project 的要求：内部逻辑是手动实现的，不是调用黑盒训练接口。

接下来进入实验部分。

---

## Slide 16 — Experiments + Discussion

实验部分同时回答两个问题。第一，从算法角度看，HDBSCAN-inspired 方法是否比 fixed-eps DBSCAN 更适合 variable-density data。第二，从系统角度看，Spark pipeline 是否表现出可解释的 scalability，以及瓶颈在哪里。

报告里的 discussion 和 limitations 也会合并到这一部分，因为实验结果不仅有成功部分，也暴露了当前 approximate implementation 的局限。

下一页先看实验设置。

---

## Slide 17 — Experimental Setup

我们做了四组实验。Experiment 1 是 synthetic variable-density data，用来验证算法质量。Experiment 2 是 strong scaling，固定 10k points，改变 cores 为 1、2、4。Experiment 3 是 data scalability，固定 4 cores，把数据规模从 1k、2k、5k 增加到 10k。Experiment 4 是 NYC Taxi real data，用真实地理点观察 DBSCAN 和 HDBSCAN-inspired 的行为。

这四组实验分成两类证据：一类是 visual quality，看 cluster shape、noise 和 over-merging；另一类是 system scalability，看 phase time、speedup 和 edge counts。

接下来先看合成数据结果。

---

## Slide 18 — Experiment 1: Variable-Density Data

这页是合成变密度数据上的三组结果。左边 DBSCAN `eps = 0.3`，噪声比例 31.3%，说明稀疏区域被大量丢弃。中间 DBSCAN `eps = 1.0`，最大簇包含 96.5% 的点，说明不同结构被过度合并。右边 HDBSCAN-inspired 产生 42 个 clusters，噪声比例 24.1%，整体上更好地保留了半月形结构、密集 blob 和部分稀疏区域。

这不是说当前实现已经等价于工业级 HDBSCAN。它仍然是 approximate pipeline，也有碎片化。但它确实减少了对单一 `eps` 的依赖，展示了 HDBSCAN 思想在 variable-density data 上的优势。

接下来从系统角度看 strong scaling。

---

## Slide 19 — Experiment 2: Strong Scaling

Strong scaling 实验固定数据规模为 10k synthetic points，改变 Spark local cores。左边是 Intel i7，右边是 Apple M1。总体趋势是一致的：从 1 core 到 2 cores，总时间明显下降；从 2 cores 到 4 cores，收益变小。4 cores 下 i7 speedup 为 1.313x，M1 speedup 为 1.524x，都明显低于理想线性加速。

关键原因在 phase breakdown。Phase 2 local MST construction 是 worker-local 的，能从更多 cores 中获益；但 Phase 3 Global MST merge 是 Driver-side Kruskal，不随 cores 增加而显著加速。这正是 Amdahl's Law：系统总加速上限由不可并行部分决定。

下一页把这个瓶颈单独放大。

---

## Slide 20 — Why Scaling Flattens

这页用 i7 的 phase breakdown 重新解释 strong scaling。绿色的 Phase 2 是可并行的 worker phase，从 1 core 到 4 cores 确实下降明显；红色的 Phase 3 是 serial driver phase，基本没有下降，甚至在 4 cores 时略有上升。

所以随着 cores 增加，可并行部分被压缩，串行部分在总时间中的占比反而更高。最终 speedup 被 Phase 3 的 driver-side global merge floor 卡住。

这页的结论是：我们的 local graph construction parallelization 是有效的，但当前架构的扩展上限来自 Driver 端 Global MST。

接下来再看数据规模增加时会发生什么。

---

## Slide 21 — Experiment 3: Data Scalability

数据扩展性实验固定 4 cores，增加数据规模。图表显示系统可以从 1k 跑到 10k，而不是一开始就被 global complete graph 卡死。理论上，如果直接构建完整 MRD complete graph，10k 点会有 49,995,000 条可能边。当前实现最终 Global MST 只有 9,999 条边，也就是 `N - 1`。

但这页也揭示了真实瓶颈：Phase 2 output candidates 到 10k 时达到 24.52M。这些不只是 Local MST edges，还包括 primary-ghost cross-boundary edges。也就是说，Local MST compression 有效控制了 partition 内 primary-primary edges，但 boundary edges 仍然可能膨胀，并加重 Driver merge 成本。

这个结果比简单说“线性扩展”更可信：我们优化了一个瓶颈，但更大规模下新的瓶颈出现了。

接下来进入真实 NYC taxi 数据。

---

## Slide 22 — Experiment 4: NYC Taxi, n = 2,000

Taxi 数据和合成数据不同，它是经纬度坐标，城市中的 pickup points 高度不均匀。2000 点实验展示了 DBSCAN 的真实地理参数敏感性。

当 `eps = 0.0005`，大约 55 米时，89.0% 的点是 noise，半径太小。当 `eps = 0.02`，大约 2.2 公里时，98.3% 的点进入最大 cluster，半径又太大，曼哈顿等高密区域被连成一片。HDBSCAN-inspired 没有像大 eps DBSCAN 那样产生巨大 over-merge，而是保留了很多 local structures；但它也比较碎片化，说明真实地理数据对当前 approximate hierarchy 仍然很难。

接下来把数据量增加到 10,000，看局限性会更明显。

---

## Slide 23 — Taxi 10,000 Reveals the Approximation Limit

这页左边是 10,000 点 taxi sweep。DBSCAN 的参数敏感性被进一步放大：`eps = 0.001` 和 `eps = 0.002` 会通过 dense neighborhood chains 把大量曼哈顿区域连成巨大 cluster。

右边是 HDBSCAN-inspired 的重要 limitation：10,000 点上有 9,998 个点被标为 noise。这个结果不能解释成 HDBSCAN 理论失败，而应该解释成当前 approximate distributed implementation 的失败。原因是，我们的 candidate graph 经过 Local MST compression 和 boundary edge selection 后，可能不是一棵连通的 global MST，而是多个 disconnected components，也就是 forest。

当前 simplified hierarchy extraction 更接近假设有一个 dominant single-root tree。如果输入实际是 forest，部分 components 可能无法正确参与 condensation 和 label propagation，最后被标成 noise。

下一页总结四组实验共同说明了什么。

---

## Slide 24 — What the Experiments Say

实验结论可以分成四类。算法层面，HDBSCAN-style hierarchy 比 fixed eps 更适合 variable-density data。并行层面，Phase 2 local graph construction 能从多 cores 中获益，说明计算下推到 workers 是有效的。瓶颈层面，Phase 3 driver-side Kruskal 是 strong scaling 的主要上限。局限性层面，`max_dist` 和 forest-aware hierarchy 是当前 approximate implementation 在真实数据上的关键问题。

这页也对应 final report 里的 discussion：我们不仅展示成功结果，也解释了系统何时失败、为什么失败。这一点对 deep project 很重要，因为评分不仅看跑通，也看对分布式瓶颈和实验观察的理解。

接下来进入结论部分。

---

## Slide 25 — Conclusion

结论部分把整个项目收束成一个核心观点：我们实现的不只是一个 clustering demo，而是一个把密度聚类算法映射到 Spark graph-compression pipeline 的系统。

前面介绍了问题、算法、Spark 实现和实验，现在最后强调项目贡献和 takeaway。

下一页是最终总结。

---

## Slide 26 — Final Takeaway

最终 takeaway 是：**a distributed HDBSCAN-style system is feasible when graph work is compressed early**。也就是说，要让 HDBSCAN 这类图密集算法在 Spark 中可运行，关键不是把完整全局图搬到 Driver，而是尽早在 partition 内压缩图结构。

这个项目完成了 distributed DBSCAN baseline 和 HDBSCAN-inspired pipeline。它手动实现了 core distance、MRD、Local MST、Global MST 和 simplified hierarchy extraction。实验显示，local graph construction 可以并行，Local MST 可以压缩 primary-primary edges，但 Driver-side global merge、boundary edges 和 forest-aware hierarchy 仍然是主要限制。

所以这个项目的价值在于：它展示了 HDBSCAN 核心思想如何被拆解并映射到 Spark/MapReduce 风格执行计划中，同时也诚实呈现了这种 approximation 的边界。

最后一页进入 Q&A。

---

## Slide 27 — Q&A / Likely Questions

如果大家有问题，我很欢迎讨论。比较可能的问题包括：为什么不用 MLlib 或现成 HDBSCAN 库；为什么当前实现称为 HDBSCAN-inspired 而不是 exact HDBSCAN；为什么 Phase 3 是瓶颈；Taxi 10,000 上的 almost-all-noise 是怎么产生的；以及如果继续优化，应该优先改哪里。

我的简短回答是：这个项目的目标是 deep project，所以重点是手动实现内部逻辑和分布式机制；HDBSCAN-inspired 的定位来自局部 KNN、Local MST 和 boundary edge approximation；Phase 3 瓶颈来自 Driver-side Kruskal；Taxi 10,000 的失败主要来自 disconnected candidate graph 和 simplified single-root hierarchy assumption。

谢谢大家，我的 presentation 到这里结束。
