# sologsb-1122 隧道掌子面地质编录台（gbtunnelface）

面向隧道施工地质人员的掌子面编录工作台：逐循环编录围岩级别、岩性、节理产状与涌水情况，绘制岩性素描并用数字表示结构面，实时按 BQ 指标判定围岩级别并给出支护建议。纯前端单页应用，数据全部保存在浏览器本地。

## Docker 一键启动（推荐）

```bash
cp .env.example .env
docker compose up -d --build
```

访问地址：**http://localhost:21822**

停止服务：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript（`<script setup>`） |
| UI | Element Plus 2 |
| 构建 | Vite 5 |
| 状态管理 | Pinia |
| 路由 | Vue Router 4（history 模式） |
| 本地存储 | IndexedDB（Dexie 4）+ localStorage（素描线段），含结构版本号与升级迁移 |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:5173
npm run build    # vue-tsc 类型检查 + vite 构建
```

> 生产环境由 nginx 托管 `dist`，`nginx.conf` 已启用 `try_files $uri $uri/ /index.html;` 与 gzip。

## 目录结构

```
sologsb-1122/
├── docker-compose.yml
├── .env.example
├── .env
└── frontend/
    ├── Dockerfile              # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf
    ├── index.html
    ├── package.json
    ├── tsconfig.json
    ├── vite.config.ts
    ├── public/favicon.svg
    └── src/
        ├── main.ts
        ├── App.vue
        ├── router/index.ts
        ├── types/{face,joint,grade,water,revision}.ts
        ├── stores/{face,joint,grade,revision}Store.ts
        ├── components/common/{SketchCanvas,JointPolarPlot,GradeTag,FaceCard,ReviseFaceDialog,RevisionList}.vue
        ├── hooks/{useFaceFilter,useGradeCalc}.ts
        ├── pages/{FaceList,FaceDetail,JointEntry,WaterView,GradeJudge}.vue
        └── utils/{db,geoMath,id,revision}.ts
```

## 页面与路由

| 路由 | 页面 | 消费模型 |
| --- | --- | --- |
| `/faces` | 掌子面台账：里程区间/岩性/围岩级别/开挖方式筛选 + 级别分布条 | TunnelFace、RockMassGrade |
| `/faces/:id` | 掌子面详情：基本信息 + 岩性素描图 + 节理组列表 + 与上循环级别比对 | TunnelFace、JointSet、RockMassGrade |
| `/faces/:id/joints` | 节理产状录入：极点图/玫瑰图、同组产状合并、异常倾角提示 | JointSet |
| `/faces/:id/water` | 涌水记录与沿里程趋势折线，标记突变点与建议措施 | WaterInflow |
| `/grade/:faceId` | 围岩级别判定：逐项输入 RQD/Jv/Kv/出水状态，实时算级别与支护建议，可人工修正并保存 | RockMassGrade、TunnelFace |

`/` 重定向到 `/faces`，未匹配路由同样兜底到 `/faces`。

## 数据存储说明

- 数据库名 `gbtunnelface`，当前结构版本 **v3**（`localStorage['gbtunnelface:db-version']` 记录）。
- 五张表：`faces`（掌子面）、`joints`（节理组）、`grades`（围岩级别判定）、`waters`（涌水记录）、`revisions`（编录修订）。
- v1 → v2 迁移：为老掌子面补 `attitude`、`mileageRange`，为级别记录补 `correctedBq`、`manualAdjusted`，为涌水补 `chainage`，并新增索引。
- v2 → v3 迁移：为老掌子面补齐修订号 `revision = 1`，为级别记录补 `status` 与 `faceRevision`；无法对应来源掌子面的判定标记为 **待复核**（`pending_review`），其余确认为 **有效**（`confirmed`）。
- 岩性素描的结构面线段单独存 `localStorage['gbtunnelface:sketch:<faceId>']`，刷新后仍在。
- 容器无状态、不挂载命名卷；清空站点数据即回到初始示范数据。
- 首次打开灌入 2 个示范掌子面、4 组节理、1 条级别判定与 3 条涌水记录。

## 功能要点

- **围岩级别实时判定**：`BQ = 90 + 3σc + 250Kv`，`[BQ] = BQ − 100(K1 + K2 + K3)`（K1 由出水状态、K2 由洞跨取值），再按 >550/451~550/351~450/251~350/151~250/≤150 映射到 Ⅰ~Ⅵ 级，并给出对应支护建议；支持人工修正级别。
- **编录修订（可回看）**：详情页「修正编录」修改里程区间/岩性/强度/产状时，保存前列出受影响的节理组、涌水记录与判定；仅当新区间不与其他掌子面重叠、且每条涌水仍落在区间内才允许提交。提交后关联判定立即失效并异步重算，重算完成前详情、台账与支护建议一律停用旧值（显示「重算中」）；重算失败则原编录、关联记录与已确认判定整体保持原样，修订留作可重试的失败版本。每次修订生成 `FaceRevision` 记录（前后快照、变更字段、影响范围、状态），详情页「修订记录」可回看、失败可重试。
- **判定状态机**：判定分 有效 / 已失效 / 待复核 三态；只有「有效」判定参与台账级别、级别比对与分布统计；待复核判定可在判定页人工复核确认。
- **级别比对**：详情页与判定页自动与上一循环级别比对，输出「变好/变差 N 级」结论。
- **素描交互**：`<SketchCanvas>` 在图上单击即按当前岩层产状布置结构面线段，带岩性填充纹样、比例尺、图例与撤销/清空，线段本地持久化。
- **节理统计**：`<JointPolarPlot>` 等面积投影极点图 + 走向玫瑰图，按组着色；按倾向 30° 聚类支持同组产状合并。
- **异常提示**：倾角超出 0~90° 直接拦截；涌水量较上一点翻倍或趋势突增标记为突变点并给出措施。
