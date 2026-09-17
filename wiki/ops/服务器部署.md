# 后端服务器配置与发布指南

本文档从 `apps/backend/README.md` 中与**服务器环境、Docker、防火墙、构建发布、PM2**相关的内容整理而来，并做了校对与补充。**请勿**将生产环境密码、JWT、云厂商密钥等写入仓库；以下示例均使用占位符。

---

## 1. 概述

### 1.1. 推荐目录约定

| 用途          | 服务器路径                                                         |
| ------------- | ------------------------------------------------------------------ |
| Nest 运行目录 | `/usr/local/dnhyxc-ai/server`                                      |
| MySQL Compose | `/usr/local/dnhyxc-ai/mysql`                                       |
| MySQL 数据卷  | `/dnhyxc-ai/mysql/db`、`/dnhyxc-ai/mysql/db1`（与 compose 中一致） |

### 1.2. 发布流程一览

1. 本地执行 `pnpm build`（在 `apps/backend` 下），生成 `dist`。
2. 将 `dist`（可打成 `dist.zip`）、`package.json`、按需更新 `.env` / `.env.production` 上传到服务器 `server` 目录。
3. 若 MySQL / Adminer 的 Compose 有变更，更新服务器 `/usr/local/dnhyxc-ai/mysql/docker-compose.yml` 后执行 `docker compose up -d`。
4. 在服务器 `server` 目录执行 `pnpm install -P`，再用 PM2 启动：`pm2 start npm --name server -- run start:prod`。
5. **阿里云安全组**与**本机 firewalld**均需放行业务端口（见第 4 节）。

---

## 2. 服务器环境准备

### 2.1 安装 nvm

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
# 或
wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
```

将以下内容写入 `~/.bashrc`（或按安装提示操作）：

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"
```

执行 `source ~/.bashrc` 使配置生效。

### 2.2 安装 Node.js

```bash
nvm install v16.14.2   # 版本可按项目要求调整
node -v
```

### 2.3 安装 nrm（可选）

网络较慢时可安装 `nrm` 切换 npm 镜像；网速正常可跳过。

```bash
npm install -g nrm
nrm --version
```

### 2.4 安装 pnpm

```bash
npm install -g pnpm
pnpm --version
```

### 2.5 安装 PM2

```bash
npm install -g pm2
pm2 --version
```

参考：[PM2 文档](https://pm2.keymetrics.io/docs/usage/quick-start/)

### 2.6 安装 docker

在服务器任意目录执行如下命令进行安装：

```bash
curl -fsSL https://get.docker.com | bash -s docker --mirror Aliyun

docker --version
```

### 2.7 安装 docker-compose

可通过 [github docker](https://github.com/docker/compose/releases) 查看具体版本，之后通过如下命令进行安装：

```bash
sudo curl -L "https://github.com/docker/compose/releases/download/v2.40.3/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose

sudo chmod +x /usr/local/bin/docker-compose

docker-compose --version
```

可参考：

- [菜鸟教程](https://www.runoob.com/docker/docker-compose.html)。

- 本地 `/Users/dnhyxc/Documents/docker` 视频教程。

### 2.8 创建数据库

在服务器 `/usr/local/dnhyxc-ai/mysql` 目录下创建 `docker-compose.yml` 文件，内容如下：

```yml
services:
  db:
    image: mysql:8.0 # 指定具体版本，避免使用 latest
    # container_name: mysql_db # dnhyxc_db
    container_name: dnhyxc_ai_db # dnhyxc_db
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: dnh@902209
      MYSQL_DATABASE: dnhyxc_ai_db # 添加默认数据库
    command:
      - --default-authentication-plugin=mysql_native_password
      - --innodb-buffer-pool-size=128M
      - --skip-name-resolve
    ports:
      - 12009:3306
    volumes:
      - /dnhyxc-ai/mysql/db:/var/lib/mysql # 持久化数据
      # - ./init.sql:/docker-entrypoint-initdb.d/init.sql # 可选初始化脚本
    healthcheck:
      test:
        [
          "CMD",
          "mysqladmin",
          "ping",
          "-h",
          "localhost",
          "-u",
          "root",
          "-p$$MYSQL_ROOT_PASSWORD",
        ]
      timeout: 20s
      retries: 10

  db1:
    image: mysql:8.0 # 指定具体版本，避免使用 latest
    # container_name: mysql_db # dnhyxc_db
    container_name: dnhyxc_ai_db_1 # dnhyxc_db
    restart: always
    environment:
      MYSQL_ROOT_PASSWORD: dnh@902209
      MYSQL_DATABASE: dnhyxc_ai_db # 添加默认数据库
    command:
      - --default-authentication-plugin=mysql_native_password
      - --innodb-buffer-pool-size=128M
      - --skip-name-resolve
    ports:
      - 12006:3306
    volumes:
      - /dnhyxc-ai/mysql/db1:/var/lib/mysql # 持久化数据
      # - ./init.sql:/docker-entrypoint-initdb.d/init.sql # 可选初始化脚本
    healthcheck:
      test:
        [
          "CMD",
          "mysqladmin",
          "ping",
          "-h",
          "localhost",
          "-u",
          "root",
          "-p$$MYSQL_ROOT_PASSWORD",
        ]
      timeout: 20s
      retries: 10

  adminer:
    image: adminer:latest
    restart: always
    ports:
      - 12011:8080 # dev 3091:8080
    depends_on:
      db:
        condition: service_healthy
```

之后在当前目录下执行 `sudo systemctl restart docker docker-compose up -d` 创建数据库容器。

```bash
sudo systemctl restart docker
docker-compose up -d
```

如果 pull 太慢可以配置镜像加速：

```bash
mkdir -p /etc/docker
cat > /etc/docker/daemon.json << 'EOF'
{
  "registry-mirrors": [
    "https://docker.1ms.run",
    "https://docker.xuanyuan.me",
    "https://docker.m.daocloud.io"
  ]
}
EOF
```

之后重启 docker：

```bash
systemctl daemon-reload
systemctl restart docker

# 重启之后重新执行
docker-compose up -d
```

创建成功后，可以通过 `docker ps` 命令查看容器状态。

### 2.9 安装 Redis

[redis 版本列表](https://download.redis.io/releases/)。

可以在上述列表中选择一个版本（redis-7.4.7.tar.gz ），并下载到本地的桌面目录。之后上传到服务器上的 `/usr/local` 目录下。之后在 `/usr/local` 目录下执行 `tar -zxvf redis-7.4.7.tar.gz` 解压。

```bash
# 从本地 /Users/dnhyxc/Desktop 目录下上传 redis-7.4.7.tar.gz 到服务器 /usr/local 目录下
scp /Users/dnhyxc/Desktop/redis-7.4.7.tar.gz root@101.43.50.15:/usr/local

cd /usr/local

# 解压 redis-7.4.7.tar.gz
tar -zxvf redis-7.4.7.tar.gz
```

之后进入 `/usr/local/redis-7.4.7` 目录下对 redis 进行编译：

```bash
cd /usr/local/redis-7.4.7

# 编译 redis 并指定安装到 /usr/local/redis
make && make PREFIX=/usr/local/redis install
```

安装完成之后进入 `/usr/local/redis/bin` 目录下，查看对应的文件列表：

```bash
cd /usr/local/redis/bin

ls
```

如果 `bin` 目录下没有以下文件，则需要从 `/usr/local/redis-7.4.7/src` 目录下复制以下文件到 `/usr/local/redis/bin` 目录下：

bin 目录下完全的文件列表：

```bash
-rwxr-xr-x 1 root root      903 Dec 27 20:04 mkreleasehdr.sh
-rwxr-xr-x 1 root root  6830832 Dec 27 20:00 redis-benchmark
lrwxrwxrwx 1 root root       12 Dec 27 20:00 redis-check-aof -> redis-server
lrwxrwxrwx 1 root root       12 Dec 27 20:00 redis-check-rdb -> redis-server
-rwxr-xr-x 1 root root  7804057 Dec 27 20:56 redis-cli
lrwxrwxrwx 1 root root       12 Dec 27 20:00 redis-sentinel -> redis-server
-rwxr-xr-x 1 root root 16198936 Dec 27 20:00 redis-server
```

如果缺少可以执行如下命令从 `/usr/local/redis-7.4.7/src` 中拷贝：

```bash
cd /usr/local/redis-7.4.7/src

cp mkreleasehdr.sh /usr/local/redis/bin
cp redis-check-aof /usr/local/redis/bin
cp redis-check-rdb /usr/local/redis/bin
cp redis-sentinel /usr/local/redis/bin
```

之后进入 `/usr/local/redis` 目录下，创建一个 `etc` 目录。

```bash
mkdir -p /usr/local/redis/etc

# 进入到 /usr/local/redis 目录下
cd /usr/local/redis
mkdir etc
```

etc 文件夹创建完成之后，进入到 `/usr/local/redis-7.4.7` 文件夹下拷贝 `redis.conf` 文件到 `/usr/local/redis/etc` 文件夹下。

```bash
cd /usr/local/redis-7.4.7

cp redis.conf /usr/local/redis/etc
```

之后进入 `/usr/local/redis/etc` 文件夹下，编辑 `redis.conf` 文件，修改该配置文件，大概在 **310 行** 左右，将 **daemonize** 由 **no** 修改为 **yes**。daemonize 表示是否以守护进程的方式启动 Redis 服务器。

```bash
cd /usr/local/redis/etc

vi +310 redis.conf

# 显示行号
set nu
```

修改完成之后，就需要配置 redis 的环境变量了，通过 `vi ~/.bash_profile` 命令进行设置。

```bash
vi ~/.bash_profile
```

在 ~/.bash_profile 文件最后添加如下内容：

```bash
# REDIS
export REDIS_HOME=/usr/local/redis/

PATH=$PATH:$HOME/bin:$REDIS_HOME/bin
```

配置完成之后，运行 `source ~/.bash_profile` 命令，使配置生效。

如果执行 `source .bash_profile` 时报错：

> manpath: can't set the locale; make sure $LC\_\* and $LANG are correct

解决方式，执行如下命令：

```bash
sudo yum install -y glibc-common
sudo localedef -v -c -i en_US -f UTF-8 en_US.UTF-8
source ~/.bash_profile
```

具体解决参考：

[deepseek-环境变量处理](https://chat.deepseek.com/a/chat/s/eeeace28-a831-49a4-826d-53e1c468cb3e)

上述操作处理完成之后，再进入 `/usr/local/redis-7.4.7/utils` 目录下执行 `./install_server.sh` 文件。

但是在执行之前，需要修改 `./install_server.sh` 文件的第 77 行到 84行的代码注释掉，防止执行报错。

```bash
cd /usr/local/redis-7.4.7/utils

vi +77 install_server.sh
```

需要注释的内容为：

```sh
_pip_1_exe="$(readlink -f /proc/1/exe)"
if [ "${_pip_1_exe##*/}" = systemd ]
then
	echo "This systems seems to use systemd."
	echo "Please take a look at the provided example service unit files in this directory, and adapt and install them, Sorry!"
	exit 1
fi
unset _pip_1_exe
```

注释完成之后再运行 `install_server.sh` 脚本，通过 `./install_server.sh` 这个服务脚本的安装，可以保证 redis 随着系统的启动而启动，即使系统重启也会帮助我们启动 redis 服务。

```bash
./install_server.sh
```

运行过后，按照指引进行安装即可，直接使用默认的，直接回车即可，如果不想要默认的端口号，可以输入其他端口（12029）。

如果修改了端口号，那么就需要将 `redis.conf` 文件中的 `port 6379` 修改为 `port 你在上述步骤中设置的端口号（12029）`。

修改完成之后运行 `ps -ef | grep redis` 命令查看 `redis` 是否启动成功。

```bash
ps -ef | grep redis
```

运行过后，如果看到如下提示，说明 redis 就启动成功了。

```
root     15307     1  0 20:50 ?        00:00:00 /usr/local/redis/bin/redis-server 127.0.0.1:12029
root     21505 10337  0 20:53 pts/0    00:00:00 grep --color=auto redis
```

之后可以通过 `redis-cli` 命令进行测试。

```bash
cd /usr/local/redis/bin

redis-cli -p 12029

set test "hello world"

get test
```

如果上述 `get test` 命令返回结果为 `"hello world"`，则说明 redis 配置已经成功了。

如果想要关闭 redis，可以使用 `redis-cli` 连接服务器之后输入 `SHUTDOWN` 命令进行关闭。或者通过进程 id 运行 `kill -9 15307` 命令进行关闭。

## 3. 防火墙、安全组与连通性（重要）

外网访问 = **云厂商安全组入方向** + **操作系统防火墙（常见为 firewalld）** + **进程监听 `0.0.0.0`/`::` 与正确端口** 三者同时满足。

### 3.1 阿里云安全组

在 ECS 控制台为实例绑定的安全组添加入方向规则，例如：

- **TCP 9112**：Nest 默认端口（或由 `PORT` 环境变量指定）。
- **TCP 12009 / 12006 / 12011**：若需从外网管理 MySQL / Adminer（生产环境建议仅放行办公网 IP，避免 `0.0.0.0/0` 暴露数据库）。

### 3.2 firewalld（与 `ufw inactive` 不矛盾）

CentOS / AlmaLinux / 部分 Ubuntu 会启用 **firewalld**（底层多为 **nftables**）。此时：

- `sudo ufw status` 可能为 `inactive`；
- 但 `sudo firewall-cmd --state` 仍为 `running`，外网仍会被拦。

放行端口示例：

```bash
sudo firewall-cmd --permanent --zone=public --add-port=12009/tcp
sudo firewall-cmd --permanent --zone=public --add-port=12006/tcp
sudo firewall-cmd --permanent --zone=public --add-port=12011/tcp
sudo firewall-cmd --permanent --zone=public --add-port=9112/tcp
sudo firewall-cmd --reload
sudo firewall-cmd --list-ports
sudo firewall-cmd --list-all
```

常用排查命令：

```bash
sudo firewall-cmd --state
journalctl -u firewalld -n 100
```

### 3.3 补充：有 SYN 无 SYN-ACK 时

若 `tcpdump` 能看到外网 **入站 SYN** 到本机内网 IP 的业务端口，但**没有出站 SYN-ACK**，而安全组已放行，请优先检查 **firewalld 是否放行该端口**（见上）。`iptables -L INPUT` 为空时，仍可能存在 **nft firewalld** 规则。

---

## 4. 构建、上传与依赖

### 4.1 本地构建

在仓库中进入后端应用目录：

```bash
cd apps/backend
pnpm build
```

将生成的 `dist` 目录打包为 `dist.zip`（或使用 `rsync` 直接同步目录）。

### 4.2 上传至服务器

在**未登录 SSH 的本地终端**使用 `scp`（示例中的 IP、路径请改成你的服务器）：

```bash
scp dist.zip root@<服务器IP>:/usr/local/dnhyxc-ai/server/
scp package.json root@<服务器IP>:/usr/local/dnhyxc-ai/server/
```

服务器上解压：

```bash
cd /usr/local/dnhyxc-ai/server
unzip dist.zip
```

### 4.3 仅安装生产依赖

```bash
cd /usr/local/dnhyxc-ai/server
pnpm install -P
```

### 4.4 环境变量文件

在 `server` 目录创建或维护 `.env`、`.env.production`。生产环境典型项包括：

- 数据库：`DB_HOST`、`DB_PORT`、`DB_USERNAME`、`DB_PASSWORD`、`DB_DATABASE`、`DB_SYNC` 等；多库时还有 `DB_DB1_PORT`、`DB_DB1_NAME` 等。
- `SECRET`（JWT 等）、`REDIS_URL`、对象存储与邮件等。

**示例（占位符，勿提交真实密钥）：**

```bash
# .env.production 示例片段
DB_TYPE=mysql
DB_HOST=127.0.0.1
DB_USER=root
DB_USERNAME=root
DB_PASSWORD=<请填写强密码>
DB_DATABASE=dnhyxc_ai_db
DB_SYNC=false
DB_PORT=12009
DB_DB1_PORT=12006
DB_DB1_NAME=db1
DB_DB1_SYNC=true

LOG_ON=true
LOG_LEVEL=info

SECRET=<请使用足够长的随机串>
REDIS_URL=redis://127.0.0.1:<Redis端口>
```

首次部署前可在服务器上**手动**执行一次验证：

```bash
cd /usr/local/dnhyxc-ai/server
pnpm run start:prod
```

无报错后再交给 PM2 托管（见下一节）。

---

## 5. PM2 启动与开机自启

```bash
cd /usr/local/dnhyxc-ai/server
pm2 start npm --name server -- run start:prod

pm2 list
pm2 logs server --lines 100
```

更新代码后的典型操作：`pnpm build` → 上传新 `dist` → `pm2 restart server`（或 `pm2 delete server` 后重新 `start`）。

保存进程列表并配置开机自启：

```bash
pm2 save
pm2 startup
# 按屏幕提示执行其输出的那条 sudo 命令
```

---

## 6. 数据库导出（运维）

在**已有本地或容器 MySQL** 的前提下，可用 `mysqldump` 导出（容器名、密码按实际修改）。

仅结构：

```bash
docker exec dnhyxc_ai_db sh -lc 'mysqldump -uroot -pexample --databases dnhyxc_ai_db --no-data --routines --triggers --events --default-character-set=utf8mb4' > dnhyxc_ai_db_schema.sql"
```

结构 + 数据：

```bash
docker exec dnhyxc_ai_db sh -lc \
  'mysqldump -uroot -p<密码> --databases dnhyxc_ai_db --routines --triggers --events --single-transaction --set-gtid-purged=OFF --default-character-set=utf8mb4' \
  > dnhyxc_ai_db_full.sql
```

---

## 7. 生产构建命令说明

在 `apps/backend` 中：

- `pnpm run build`：`NODE_ENV=production nest build`，输出到 `dist`。
- `pnpm run start:prod`：`NODE_ENV=production node dist/src/main`（与 PM2 中 `run start:prod` 一致）。

---

## 8. Docker 维护（本地或服务器通用）

停止并删除 Compose 定义的资源（注意 `-v` 会删卷，慎用）：

```bash
docker compose down -v
```

清理未使用镜像与卷（**危险操作**，会删除未使用的镜像与卷）：

```bash
docker system prune -a --volumes
```

---

## 9. 检查清单（发布前快速核对）

- [ ] 安全组已放行 `PORT`（默认 9112）及所需数据库/管理端口。
- [ ] `firewall-cmd --state` 若为 `running`，已 `reload` 且 `--list-ports` 含上述端口。
- [ ] `.env.production` 中数据库端口与 `docker-compose` 映射一致。
- [ ] `pnpm install -P` 已在本次上传的 `package.json` 变更后执行。
- [ ] `pm2 logs` 无持续报错，外网健康检查或业务接口可访问。

---

更细的逐步截图级说明（如 Redis `install_server.sh` 注释段落）仍保留在 `apps/backend/README.md` 中，可按需对照；**以本文档为发布与防火墙策略的索引**即可。

# 无法连接腾讯云 root@101.43... →点击查看智谱清言的回答https://chatglm.cn/share/xFOamL4i
