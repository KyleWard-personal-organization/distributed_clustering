# PPT Presentation Script (English)

> Note: This script is aligned with the current 27-slide deck. Each section corresponds to one slide and includes natural transition sentences for a live presentation.

---

## Slide 1 — Distributed HDBSCAN & DBSCAN

Hello everyone. Our deep project is titled **Distributed HDBSCAN & DBSCAN with Apache Spark**. The goal is not to simply call an existing clustering library. Instead, we implement the internal logic of density-based clustering and map the graph-heavy parts of the algorithm into a Spark-based distributed pipeline.

This project has two perspectives. From the machine learning perspective, we study why DBSCAN struggles on variable-density data and why HDBSCAN-style ideas are more suitable. From the distributed systems perspective, HDBSCAN depends on KNN, mutual reachability graphs, and minimum spanning trees, which are naturally global computations. Our question is how to approximate and distribute these computations using partitioning, ghost points, Local MST compression, and driver-side merging.

Let us first look at the roadmap of the presentation.

---

## Slide 2 — Presentation Roadmap

The presentation has five parts. First, the introduction explains the problem background and project objective. Second, the algorithm overview introduces DBSCAN, HDBSCAN, and the distributed challenges behind them. Third, the Spark implementation section explains how the algorithm is organized as an RDD pipeline. Fourth, the experiments and discussion section presents synthetic results, scalability experiments, and NYC taxi real-data results. Finally, we conclude with the key takeaways.

The through-line is: **variable density meets distributed graph computation**. In other words, we are solving both a clustering-quality problem and a distributed graph-processing problem.

Now let us start with why this problem matters.

---

## Slide 3 — Introduction

This section motivates the problem. Density-based clustering is attractive because it does not require the number of clusters in advance, it can find clusters with arbitrary shapes, and it can explicitly label outliers as noise.

However, traditional DBSCAN relies on one global `eps`. When the data contains both dense and sparse regions, one fixed radius cannot fit all regions well. This is why we bring in HDBSCAN-style density hierarchy.

On the next slide, I will make this tension more concrete.

---

## Slide 4 — Problem Background

This slide shows the background of the project. On the left, the goal of density clustering is to discover arbitrary-shaped regions from point clouds and identify noise. In the middle, the core weakness of DBSCAN is the fixed `eps`: if `eps` is too small, sparse regions become noise; if `eps` is too large, nearby regions are over-merged.

On the right, we have the systems challenge. HDBSCAN replaces one fixed `eps` with a density hierarchy, but it introduces heavier graph computation: core distance, mutual reachability distance, MST construction, and hierarchy extraction. These are already expensive on one machine, and in Spark we must also handle partition boundaries, ghost points, and global merging.

So the central question of this project is: can we manually implement an interpretable distributed density-clustering system that captures the algorithmic ideas of DBSCAN and HDBSCAN while also demonstrating Spark and MapReduce-style distributed design?

Next, let us look at the concrete project objectives.

---

## Slide 5 — Project Objective

The project has three main objectives. First, we implement a distributed DBSCAN baseline with grid partitioning, ghost points, local DBSCAN, and Union-Find merging. Second, we implement an HDBSCAN-inspired distributed pipeline with KD-tree partitioning, local MRD graphs, Local MST compression, Global MST merging, and simplified hierarchy extraction. Third, we evaluate both clustering quality and system scalability through experiments.

An important course requirement is that we cannot simply call Spark MLlib or an existing HDBSCAN package. In this project, spatial partitioning, distance matrices, Union-Find, Kruskal MST, RDD transformations, and phase-level timing are implemented or explicitly organized by ourselves.

With the objective clear, let us move to the algorithm design.

---

## Slide 6 — Algorithm Overview

The algorithm section moves from fixed-radius density rules to graph-based density hierarchy. We start with DBSCAN because it is the most intuitive density-clustering baseline. Then we show why fixed `eps` fails. After that, we explain how HDBSCAN uses core distance, MRD, MST, and stability to reduce dependence on one global threshold.

It is important that we are not presenting DBSCAN only as a single-machine algorithm. We use it to explain what extra mechanisms are required in a distributed setting.

Let us begin with the distributed DBSCAN baseline.

---

## Slide 7 — Distributed DBSCAN Baseline

Inside each Spark partition, DBSCAN still uses the classic `eps / minPts` rule. If a point has enough neighbors within the `eps` radius, it is a core point, and clusters expand through density-connected relationships.

The distributed difficulty is that a point's neighbors may be located in another partition. If each partition runs DBSCAN independently, one true cross-boundary cluster may be split into multiple local clusters. Therefore, our baseline follows this pipeline: grid partitioning, boundary ghost-point replication, local DBSCAN inside each partition, and finally Union-Find merging on the driver to reconcile local clusters.

The key point is that DBSCAN's local rule is simple, but distributed correctness depends on ghost points and global label reconciliation.

Next, let us look at the failure mode of fixed `eps` using real experimental figures.

---

## Slide 8 — Fixed eps Creates Opposite Failure Modes

This slide shows two DBSCAN results on synthetic variable-density data. On the left, when `eps = 0.3`, the small radius preserves some dense structures, but many sparse regions are fragmented or labeled as noise. The noise ratio reaches 31.3%. On the right, when `eps = 1.0`, noise decreases, but 96.5% of points are merged into one giant cluster.

This shows that the issue is not just parameter tuning. The deeper problem is that one global radius is not suitable for variable-density data. Increasing `eps` to cover sparse regions causes over-merging; decreasing `eps` to protect dense structures discards sparse clusters.

This motivates the HDBSCAN-style approach.

---

## Slide 9 — HDBSCAN Replaces eps with Density Hierarchy

HDBSCAN no longer asks whether two points are within one fixed `eps`. Instead, it first computes the core distance of each point, then defines mutual reachability distance: `MRD(a,b) = max(core(a), core(b), dist(a,b))`. This distance stretches connections in sparse regions and helps separate structures with different densities.

Then HDBSCAN builds an MST on the MRD graph and forms a hierarchy from the edge weights. Finally, rather than selecting one fixed distance threshold, it selects clusters based on stability across density levels.

From a single-machine perspective, this is a chain of global KNN, MRD graph, MST, and hierarchy extraction. From a distributed perspective, the challenge is that these objects are global. Our implementation approximates this with local KNN/MRD computation, Local MST compression, and driver-side merging.

Next, let us look at the full distributed pipeline.

---

## Slide 10 — Distributed HDBSCAN-Inspired Pipeline

This slide is the central algorithmic design. Phase 1 builds KD-tree-style spatial partitions and uses ghost points for soft boundaries. Phase 2 is the main worker-local parallel layer: each partition computes a local MRD graph and builds a Local MST using Kruskal. Phase 3 collects compressed edges to the driver and builds the Global MST. Phase 4 performs condensed-tree extraction and label assignment.

The design principle is: **keep expensive graph construction local and move only compressed connectivity evidence globally**. The heavy distance matrices and local graph computation are pushed down to workers. The driver does not receive the full MRD complete graph; it receives Local MST edges plus boundary edges.

Now let us move from algorithm design to Spark implementation.

---

## Slide 11 — Spark Implementation

This section translates the algorithm into Spark execution. We focus on what the driver does, what the workers do, how RDD transformations are organized, and where the bottlenecks appear.

Spark does not automatically solve the distributed algorithm for us. In this project, `flatMap` is used for ghost-point replication, `groupByKey` groups points by partition, `persist + count` materializes RDDs and records phase timing, `collect` brings compressed edges to the driver for global merging, and `broadcast` sends final labels back to workers.

On the next slide, we look at the system architecture.

---

## Slide 12 — System Architecture

This slide shows the responsibilities of the driver and Spark workers. The driver samples data, builds KD-tree partition rules, and broadcasts these rules to workers. The workers perform partition-local MRD and Local MST construction in parallel. The driver then collects compressed edges, builds the Global MST, and extracts labels.

At the bottom, we show the RDD execution path: `flatMap` replicates ghost points, `groupByKey` assembles partitions, `persist + count` materializes RDDs and enables timing, `collect` brings compressed edges back to the driver, and `broadcast` sends final labels back.

The key point is that we explicitly separate parallelizable work from driver-side global logic.

Next, let us look more closely at boundary handling with ghost points.

---

## Slide 13 — Soft Boundary with Ghost Points

If partition boundaries are hard cuts, near-boundary neighbor relationships can be lost. For DBSCAN, this may split one cross-boundary cluster. For the HDBSCAN-inspired pipeline, it may remove important cross-partition edges from the MRD candidate graph.

We use ghost points to create a soft overlap band. In DBSCAN, the overlap radius can be `eps`. In HDBSCAN, there is no fixed `eps`, so we introduce `max_dist` to control boundary replication. A near-boundary point can appear as a ghost copy in a neighboring partition, so both workers can see the local neighborhood.

This is an engineering trade-off: if `max_dist` is too small, cross-partition connections may be missed; if it is too large, ghost points and boundary edges can grow quickly.

Next, let us see why Local MST compression is the most important optimization.

---

## Slide 14 — Local MST Compression

Inside one partition, if we keep all MRD edges, the number of edges is `O(M^2)`. This is expensive for both communication and driver memory. Our approach is to run Kruskal inside each worker first and compress the primary-primary local graph into a Local MST skeleton.

The left side represents a dense local MRD graph. The right side represents the Local MST, which keeps only the essential connectivity structure. This reduces primary-primary edges from `O(M^2)` to roughly `M - 1`. Cross-partition primary-ghost boundary edges are kept separately for global connectivity.

This step is a direct example of MapReduce push-down: heavy computation stays local, and the driver receives compressed edges only.

Next, let us map these implementation pieces to the codebase.

---

## Slide 15 — Implementation Map

This slide maps the code structure. `core/partitioning.py` implements grid and KD-tree partitioners and ghost-point logic. `dbscan/local_dbscan.py` implements local distance matrices and BFS cluster expansion. `dbscan/distributed.py` handles partitioning, local DBSCAN, and Union-Find merging.

For HDBSCAN, `hdbscan/local_graph.py` implements core distance, MRD, and Local MST. `hdbscan/distributed.py` organizes the 4-phase pipeline. `hdbscan/tree_hierarchy.py` performs simplified condensation and stability-based labeling. The low-level Union-Find and Kruskal MST logic is reused from `core/graph.py`.

This shows that the project satisfies the deep project requirement: the internal logic is implemented manually, rather than delegated to black-box library calls.

Now let us move to experiments.

---

## Slide 16 — Experiments + Discussion

The experiment section answers two questions. First, from the algorithmic perspective, is the HDBSCAN-inspired method more suitable than fixed-eps DBSCAN for variable-density data? Second, from the systems perspective, does the Spark pipeline show interpretable scalability, and where are the bottlenecks?

The discussion and limitations from the report are also integrated into this section. The results include both successes and limitations of the current approximate implementation.

Next, let us start with the experimental setup.

---

## Slide 17 — Experimental Setup

We conduct four groups of experiments. Experiment 1 uses synthetic variable-density data to test clustering quality. Experiment 2 is a strong scaling experiment: we fix 10k points and vary the number of cores as 1, 2, and 4. Experiment 3 is data scalability: we fix 4 cores and increase the dataset size from 1k to 2k, 5k, and 10k. Experiment 4 uses NYC Taxi real-world geographic data.

These experiments provide two types of evidence. The first type is visual quality: cluster shape, noise, and over-merging. The second type is system scalability: phase time, speedup, and edge counts.

Now let us look at the synthetic data results.

---

## Slide 18 — Experiment 1: Variable-Density Data

This slide shows three results on synthetic variable-density data. On the left, DBSCAN with `eps = 0.3` has 31.3% noise, meaning sparse regions are heavily discarded. In the middle, DBSCAN with `eps = 1.0` puts 96.5% of points into one cluster, meaning different structures are over-merged. On the right, the HDBSCAN-inspired method produces 42 clusters and 24.1% noise, preserving the moon shapes, dense blob, and part of the sparse regions more naturally.

This does not mean our implementation is an industrial exact HDBSCAN. It is still an approximate pipeline and it still has fragmentation. But it does reduce dependence on a single `eps` and demonstrates the advantage of HDBSCAN-style density hierarchy on variable-density data.

Next, let us look at strong scaling from the systems perspective.

---

## Slide 19 — Experiment 2: Strong Scaling

The strong scaling experiment fixes the dataset size at 10k synthetic points and varies Spark local cores. The left figure is for Intel i7, and the right figure is for Apple M1. Both platforms show the same trend: moving from 1 core to 2 cores reduces total runtime significantly, while moving from 2 cores to 4 cores gives much smaller benefit. At 4 cores, the i7 speedup is 1.313x and the M1 speedup is 1.524x, both far below ideal linear speedup.

The reason is visible in the phase breakdown. Phase 2, Local MST construction, is worker-local and benefits from more cores. Phase 3, Global MST merging, is driver-side Kruskal and does not improve with more Spark cores. This is exactly Amdahl's Law: the overall speedup is limited by the sequential part.

The next slide zooms in on this bottleneck.

---

## Slide 20 — Why Scaling Flattens

This slide re-expresses the i7 phase breakdown. The green Phase 2 is the parallelizable worker phase, and it decreases as the number of cores increases. The red Phase 3 is the serial driver phase, and it barely decreases; at 4 cores, it even increases slightly.

As we add more cores, the parallel part gets compressed, but the serial part becomes a larger fraction of total runtime. Therefore, the speedup is capped by the Phase 3 driver-side global merge floor.

The conclusion is that our local graph parallelization works, but the current scalability limit is the driver-side Global MST.

Next, let us see what happens when the data size grows.

---

## Slide 21 — Experiment 3: Data Scalability

The data scalability experiment fixes 4 cores and increases dataset size. The figures show that the system can run from 1k to 10k points instead of immediately failing on a global complete graph. In theory, directly constructing the full MRD complete graph for 10k points would require 49,995,000 possible edges. Our final Global MST has only 9,999 edges, which is `N - 1`.

However, this slide also shows the real bottleneck. At 10k points, Phase 2 output candidates reach 24.52 million. These are not only Local MST edges; they also include primary-ghost cross-boundary edges. So Local MST compression controls primary-primary edges within partitions, but boundary edges can still grow and make driver merging expensive.

This result is more credible than simply claiming linear scalability. We optimized one bottleneck, and a new bottleneck becomes visible at larger scale.

Next, we move to the real NYC taxi data.

---

## Slide 22 — Experiment 4: NYC Taxi, n = 2,000

Taxi data is different from synthetic data. It uses longitude and latitude, and pickup points are highly uneven across the city. The 2,000-point experiment shows DBSCAN's parameter sensitivity in a real geographic setting.

When `eps = 0.0005`, roughly 55 meters, 89.0% of points are noise, so the radius is too small. When `eps = 0.02`, roughly 2.2 kilometers, 98.3% of points fall into the largest cluster, so the radius is too large and dense areas such as Manhattan become connected into one giant component. The HDBSCAN-inspired method avoids this huge over-merge and preserves many local structures, but it is still fragmented, which shows that real geographic data is difficult for the current approximate hierarchy.

Next, we increase the dataset to 10,000 points, where the limitation becomes clearer.

---

## Slide 23 — Taxi 10,000 Reveals the Approximation Limit

On the left, the 10,000-point taxi sweep further amplifies DBSCAN's parameter sensitivity. With `eps = 0.001` and `eps = 0.002`, dense neighborhood chains connect much of Manhattan into a giant cluster.

On the right, we show an important limitation of the HDBSCAN-inspired implementation: on 10,000 taxi points, 9,998 points are labeled as noise. This should not be interpreted as a failure of HDBSCAN theory. It is a limitation of our approximate distributed implementation. After Local MST compression and boundary edge selection, the candidate graph may not be one connected global MST. It may become a forest with multiple disconnected components.

The current simplified hierarchy extraction mainly assumes a dominant single-root tree. If the input is actually a forest, some components may not participate correctly in condensation and label propagation, and those points can end up as noise.

The next slide summarizes what the experiments tell us.

---

## Slide 24 — What the Experiments Say

The experimental conclusions can be grouped into four points. Algorithmically, HDBSCAN-style hierarchy handles variable density better than fixed `eps`. In terms of parallelism, Phase 2 local graph construction benefits from multiple cores, which confirms the value of pushing computation down to workers. In terms of bottlenecks, Phase 3 driver-side Kruskal is the main limit for strong scaling. In terms of limitations, `max_dist` and forest-aware hierarchy are key issues for the current approximate implementation on real data.

This slide corresponds to the discussion section of the final report. We do not only show successful results; we also explain when and why the system fails. This is important for a deep project, because the grading focuses not only on whether the code runs, but also on understanding distributed bottlenecks and experimental observations.

Now let us move to the conclusion.

---

## Slide 25 — Conclusion

The conclusion brings the project back to one central idea: this is not only a clustering demo. It is a system that maps density-based clustering into a Spark graph-compression pipeline.

We have covered the problem, the algorithms, the Spark implementation, and the experiments. Now we close with the main contributions and takeaway.

The next slide gives the final takeaway.

---

## Slide 26 — Final Takeaway

The final takeaway is: **a distributed HDBSCAN-style system is feasible when graph work is compressed early**. To make graph-heavy algorithms like HDBSCAN runnable in Spark, the key is not to send the full global graph to the driver. The key is to compress graph structure as early as possible inside partitions.

This project implements both a distributed DBSCAN baseline and an HDBSCAN-inspired pipeline. It manually implements core distance, MRD, Local MST, Global MST, and simplified hierarchy extraction. The experiments show that local graph construction can be parallelized and that Local MST compression reduces primary-primary edges. However, driver-side global merging, boundary edges, and forest-aware hierarchy remain the main limitations.

The value of the project is that it demonstrates how core HDBSCAN ideas can be decomposed and mapped into a Spark/MapReduce-style execution plan, while honestly presenting the boundaries of this approximation.

The final slide is Q&A.

---

## Slide 27 — Q&A / Likely Questions

I am happy to take questions. Likely questions include: why we do not use MLlib or an existing HDBSCAN library; why this implementation is called HDBSCAN-inspired rather than exact HDBSCAN; why Phase 3 is the bottleneck; what caused the almost-all-noise result on Taxi 10,000; and what should be optimized first if we continue this project.

My short answer is: this is a deep project, so the focus is manual implementation of internal logic and distributed mechanisms. The HDBSCAN-inspired positioning comes from local KNN, Local MST, and boundary-edge approximation. The Phase 3 bottleneck comes from driver-side Kruskal. The Taxi 10,000 failure mainly comes from a disconnected candidate graph and the simplified single-root hierarchy assumption.

Thank you. That concludes my presentation.
