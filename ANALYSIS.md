# Shiori 维护概览

Shiori v1.0.0 是面向小团队的自托管工作区。Workshop 统一管理个人与团队项目。Boards、Docs、Sheets 和 Slides 使用版本化命令同步，项目权限和已提交历史存放在 PostgreSQL。默认 Docker Compose 还运行 Redis、SeaweedFS 和独立的后台 worker。

- [发布与部署](https://github.com/xiaotwu/Shiori/releases/latest)提供 Compose 包和适用于 Linux ARM64 与 AMD64 的镜像。安装、升级、备份和恢复见[部署文档](docs/guide/docker.md)与[运维手册](docs/guide/operations.md)。
- [技术架构](docs/guide/architecture.md)介绍服务和编辑提交路径，[同步协议](contracts/board-sync.md)记录命令、收据及离线队列行为。
- [产品计划](PRODUCT_PLAN.md)记录试点验收和后续实施顺序。

重构前的代码审阅可从[历史版本](https://github.com/xiaotwu/Shiori/blob/72cb52d56a0e144eac33b9316715ce36987be983/ANALYSIS.md)查阅。
