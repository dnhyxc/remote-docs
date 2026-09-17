#### 服务器准备

服务器选择看个人喜好，可以在腾讯云、阿里云、华为云等上购买轻量服务器。目前本人选择的是腾讯云的轻量服务器。因此以下所有设置都是针对腾讯云服务器进行的。但是其它的服务器也大差不差，配置方式基本是一样的。

#### node、mongodb、nginx 压缩包准备

node 安装包下载：[v14.9.0](https://nodejs.org/dist/v14.9.0/)。

mongodb 安装包下载：[CentOS 7.0 x64-5.0.14 tgz 压缩包](https://www.mongodb.com/try/download/community)。

nginx 安装包下载：[nginx-1.22.1 pgp](https://nginx.org/en/download.html)。

> 以上安装包的版本，官网可能会不存在，如果没有找到上述对应的版本，最好选择与之相近的版本，防止出现不兼容的情况。

#### 安装 node、pm2、yarn

输入命令 `cd /usr/local` 进入到 local 文件夹中。进入到 local 文件夹中后，输入命令 `mkdir node` 创建一个 node 文件夹。之后 `cd node` 到 node 目录下，在 node 目录下输入命令 `rz` 将下载的 node 包上传到 `/usr/local/node` 文件夹中，紧接着在当前 node 目录下输入如下命令：

- `tar -vxf node-v14.9.0-linux-x64.tar.xz` 命令将 node 进行解压。解压完成之后，`cd node-v14.9.0-linux-x64/bin` 到 node-v14.9.0-linux-x64 下的 bin 目录下，接着输入命令：
  - `ln -s /usr/local/node/node-v14.9.0-linux-x64/bin/node /usr/local/bin/node` 设置 node 环境变量。

  - `ln -s /usr/local/node/node-v14.9.0-linux-x64/bin/npm /usr/local/bin/npm` 设置 node 环境变量。

  - `npm i yarn -g` 安装 yarn，同时输入：`ln -s /usr/local/node/node-v14.9.0-linux-x64/bin/yarn /usr/local/bin/yarn` 设置 node 环境变量。

  - `npm i pm2 -g` 安装 pm2，同时输入：`ln -s /usr/local/node/node-v14.9.0-linux-x64/bin/pm2 /usr/local/bin/pm2` 设置 node 环境变量。

具体命令总结如下，依次执行即可：

```yaml
cd /usr/local

mkdir node

cd node

rz  #选择node-v14.9.0-linux-x64.tar.xz

tar -vxf node-v14.9.0-linux-x64.tar.xz

cd node-v14.9.0-linux-x64/bin

ln -s /usr/local/node/node-v14.9.0-linux-x64/bin/node /usr/local/bin/node

ln -s /usr/local/node/node-v14.9.0-linux-x64/bin/npm /usr/local/bin/npm

npm i yarn -g

ln -s /usr/local/node/node-v14.9.0-linux-x64/bin/yarn /usr/local/bin/yarn

npm i pm2 -g

ln -s /usr/local/node/node-v14.9.0-linux-x64/bin/pm2 /usr/local/bin/pm2
```

#### 安装及启动 mongodb

`cd /usr/local` 目录下，使用 `mkdir mongodb` 创建 mongodb 文件夹。

`cd /` 到根目录，使用命令 `mkdir -p /data/db` 创建 db 文件夹。再使用 `mkdir -p /data/log` 创建 log 文件夹，用于存储数据及日志。

`cd /usr/local/mongodb` 文件夹下，使用 `rz` 命令将下载好的压缩包通过了 `tar -vxf mongodb-linux-x86_64-rhel70-5.0.14.tgz` 进行解压。

`cd mongodb-linux-x86_64-rhel70-5.0.14/bin` 目录，再使用 `./mongod --dbpath=/data  --logpath=/data/log/mongod.log --fork` 在后台启动 mongodb。

具体命令总结如下，依次执行即可：

```yaml
cd /usr/local

mkdir mongodb

cd /

mkdir -p /data/db

mkdir -p /data/log

cd /usr/local/mongodb

rz  #选择下载好的 mongodb-linux-x86_64-rhel70-5.0.14.tgz 压缩包

tar -vxf mongodb-linux-x86_64-rhel70-5.0.14.tgz

cd mongodb-linux-x86_64-rhel70-5.0.14/bin

./mongod --dbpath=/data  --logpath=/data/log/mongod.log --fork
```

#### 连接数据库

```yaml
cd /usr/local/mongodb/mongodb-linux-x86_64-rhel70-5.0.14/bin

./mongo
```

#### 安装 nginx

首先 `cd /usr/local` 到 local 文件目录下，在 local 文件夹中通过命令 `mkdir nginx` 创建 nginx 文件夹，接着 `cd nginx` 进入 nginx 文件夹，使用 `rz nginx-1.22.1.tar.gz` 命令将下载好的 nginx 压缩包上传到 nginx 文件夹中。接着在 nginx 文件夹中通过 `tar -vxf nginx-1.22.1.tar` 解压该 tar 包。具体命令依次如下：

```yaml
cd /usr/local

mkdir nginx

cd nginx

rz  #选择 nginx-1.22.1.tar.gz

tar -vxf nginx-1.22.1.tar
```

#### 执行 configure 等命令

进入 `/usr/local/nginx/nginx-1.22.1` 文件目录中，依次按如下命令执行：

```yaml
cd /usr/local/nginx/nginx-1.22.1

./configure  #配置软件的编译参数和环境设置

make  #使用 make 命令来编译软件

make install  #将编译好的软件安装到系统中

/usr/local/nginx/sbin/nginx -c /usr/local/nginx/conf/nginx.conf  #指定其配置文件的路径
```

如果执行 `./configure` 报错：

```
./configure: error: the HTTP rewrite module requires the PCRE library.
You can either disable the module by using --without-http_rewrite_module
option, or install the PCRE library into the system, or build the PCRE library
statically from the source with nginx by using --with-pcre=<path> option.
```

需要安装：

```bash
sudo apt-get update
sudo apt-get install -y libpcre3 libpcre3-dev zlib1g-dev libssl-dev
```

安装完层之后，再在 `/usr/local/nginx/nginx-1.22.1` 目录下运行如下命令：

```bash
# cd /usr/local/nginx/nginx-1.22.1

./configure

make

make install
```

#### nginx.conf 配置

```yaml
#user  nobody;
worker_processes  1;

#error_log  logs/error.log;
#error_log  logs/error.log  notice;
#error_log  logs/error.log  info;

#pid        logs/nginx.pid;

events {
  worker_connections  1024;
}

http {
  include       mime.types;
  default_type  application/octet-stream;
  sendfile  on;
  keepalive_timeout   65;
  client_max_body_size  100m;  #上传size改为20m，防止文件过大无法上传

  #log_format  main  '$remote_addr - $remote_user [$time_local] "$request" '
  #'$status $body_bytes_sent "$http_referer" '
  #'"$http_user_agent" "$http_x_forwarded_for"';
  #access_log  logs/access.log  main;
  #tcp_nopush     on;
  #keepalive_timeout  0;

  gzip  on; #开启 gizp 压缩
  gzip_min_length 1k; #指定启用 Gzip 压缩的最小文件大小。这里表示文件大小至少为 1KB 时才会被压缩。
  gzip_buffers 4 16k; #指定用于压缩的内存缓冲区大小。这里的含义是每个缓冲区大小为 16KB，一共分配 4 个缓冲区。
  gzip_http_version 1.0; #指定启用 Gzip 压缩的 HTTP 协议版本。在这个示例中，仅对 HTTP 1.0 及以上版本的请求启用 Gzip 压缩。
  gzip_comp_level 5;  #指定 Gzip 压缩的压缩级别。级别越高，压缩比越大，但同时也会消耗更多的 CPU 资源。这里的值为 5，表示中等压缩级别。
  gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;  #指定要进行 Gzip 压缩的 MIME 类型。只有在这些 MIME 类型匹配的响应数据才会被压缩。
  gzip_vary on; #指定是否在响应头中添加 Vary 头。Vary 头的作用是告诉缓存服务器根据不同的请求头来缓存不同的响应，从而避免缓存混乱。这里的值为 on，表示启用 Vary 头。

  server {
    listen       80;
    server_name  localhost;
    #charset koi8-r;
    #access_log  logs/host.access.log  main;
    location / {
      root  /usr/local/nginx/dnhyxc/dist; #设置前端资源包的路径
      index   index.html  index.htm;  #设置前端资源入口html文件
      try_files   $uri  $uri/ /index.html;  #解决 browserRouter 页面刷新后出现404
    }

    location /api/ {
      proxy_set_header  Host  $http_host;
      proxy_set_header  X-Real-IP $remote_addr;
      proxy_set_header  REMOTE-HOST $remote_addr;
      proxy_set_header  X-Forwarded-For   $proxy_add_x_forwarded_for;
      proxy_pass  http://localhost:9112;
    }

    location /admin/ {
      proxy_set_header  Host  $http_host;
      proxy_set_header  X-Real-IP $remote_addr;
      proxy_set_header  REMOTE-HOST $remote_addr;
      proxy_set_header  X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_pass  http://localhost:9112;
    }

    location /image/ {
      root  /usr/local/server/src/upload/image;
      rewrite  ^/usr/local/server/src/upload/(.*) /$1 break;
      proxy_pass  http://localhost:9112;
    }


    location /atlas/ {
      root  /usr/local/server/src/upload/atlas;
      rewrite  ^/usr/local/server/src/upload/(.*) /$1 break;
      proxy_pass  http://localhost:9112;
    }

    location /files/ {
      root  /usr/local/server/src/upload/files;
      rewrite  ^/usr/local/server/src/upload/(.*) /$1 break;
      proxy_pass  http://localhost:9112;
    }

    #error_page  404  /404.html;
    # redirect server error pages to the static page /50x.html
    #
    error_page   500 502 503 504  /50x.html;
    location = /50x.html {
      root   html;
    }
  # proxy the PHP scripts to Apache listening on 127.0.0.1:80
  #
  #location ~ \.php$ {
  #    proxy_pass   http://127.0.0.1;
  #}
  # pass the PHP scripts to FastCGI server listening on 127.0.0.1:9000
  #
  #location ~ \.php$ {
  #    root           html;
  #    fastcgi_pass   127.0.0.1:9000;
  #    fastcgi_index  index.php;
  #    fastcgi_param  SCRIPT_FILENAME  /scripts$fastcgi_script_name;
  #    include        fastcgi_params;
  #}
  # deny access to .htaccess files, if Apache's document root
  # concurs with nginx's one
  #
  #location ~ /\.ht {
  #    deny  all;
  #}
}

server {
  listen  9216;
  server_name  localhost;

  location / {
    root  /usr/local/nginx/html/dist;
    index   index.html  index.htm;
    try_files   $uri  $uri/ /index.html;
  }

  location /api/ {
    proxy_set_header  Host  $http_host;
    proxy_set_header  X-Real-IP $remote_addr;
    proxy_set_header  REMOTE-HOST $remote_addr;
    proxy_set_header  X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass  http://localhost:9112;
  }

  location /image/ {
    root  /usr/local/server/src/upload/image;
    rewrite  ^/usr/local/server/src/upload/(.*) /$1 break;
    proxy_pass  http://localhost:9112;
  }

  location /files/ {
    root  /usr/local/server/src/upload/files;
    rewrite  ^/usr/local/server/src/upload/(.*) /$1 break;
    proxy_pass  http://localhost:9112;
  }

  error_page  500 502 503 504 /50x.html;
  location = /50x.html {
    root  html;
  }
}

server {
  listen  9116;
  server_name  localhost;

  location / {
    root  /usr/local/nginx/html_web/dist;
    index   index.html  index.htm;
    try_files   $uri  $uri/ /index.html;
  }

  location /api/ {
    proxy_set_header  Host  $http_host;
    proxy_set_header  X-Real-IP $remote_addr;
    proxy_set_header  REMOTE-HOST $remote_addr;
    proxy_set_header  X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass  http://localhost:9112;
  }

  location /image/ {
    root  /usr/local/server/src/upload/image;
    rewrite  ^/usr/local/server/src/upload/(.*) /$1 break;
    proxy_pass  http://localhost:9112;
  }

  location /files/ {
    root  /usr/local/server/src/upload/files;
    rewrite  ^/usr/local/server/src/upload/(.*) /$1 break;
    proxy_pass  http://localhost:9112;
  }

  error_page  500 502 503 504 /50x.html;
  location = /50x.html {
    root  html;
  }
}

server {
  listen  9612;
  server_name  localhost;
  location / {
    root  /usr/local/nginx/web/dist;
    index   index.html  index.htm;
    try_files   $uri  $uri/ /index.html;
  }

  location /api/ {
    proxy_set_header  Host  $http_host;
    proxy_set_header  X-Real-IP $remote_addr;
    proxy_set_header  REMOTE-HOST $remote_addr;
    proxy_set_header  X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass  http://localhost:9112;
  }

  location /image/ {
    root  /usr/local/server/src/upload/image;
    rewrite  ^/usr/local/server/src/upload/(.*) /$1 break;
    proxy_pass  http://localhost:9112;
  }

  location /files/ {
    root  /usr/local/server/src/upload/files;
    rewrite  ^/usr/local/server/src/upload/(.*) /$1 break;
    proxy_pass  http://localhost:9112;
  }

  error_page  500 502 503 504 /50x.html;
  location = /50x.html {
    root  html;
  }
}

server {
    listen  8090;
    server_name  wwww.dnhyxc.cn;

    location / {
      root  /usr/local/nginx/html_admin/dist;
      index   index.html  index.htm;
      try_files   $uri  $uri/ /index.html;
    }

    location /admin/ {
      proxy_set_header  Host  $http_host;
      proxy_set_header  X-Real-IP $remote_addr;
      proxy_set_header  REMOTE-HOST $remote_addr;
      proxy_set_header  X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_pass  http://localhost:9112;
    }
  }
}
```

### nginx 配置 https

首先去腾讯云申请免费证书，申请通过之后，下载 `nginx` 类型的证书文件文件，之后将证书文件上传到服务器的某个目录中，本人将证书放在服务器 `/usr/local/nginx/certs` 目录下。 之后通过 `unzip xxx.zip` 解压上传的证书 zip 压缩包。

在命令行未连接服务器的情况下运行 `scp /Users/dnhyxc/Desktop/dnhyxc.cn_nginx.zip  root@101.43.50.15:/usr/local/nginx/certs`

- /Users/dnhyxc/Desktop/dnhyxc.cn_nginx.zip：本地证书压缩包路径。

- root@101.43.50.15:/usr/local/nginx/certs：服务器放置证书的路径。

证书解压完成后，会得到四个文件，分别是：

1. dnhyxc.cn_bundle.crt

2. dnhyxc.cn_bundle.pem

3. dnhyxc.cn.key

4. dnhyxc.cn.csr

上述四个文件中，我们实际用到的是 `dnhyxc.cn_bundle.crt` 和 `dnhyxc.cn.key` 这两个文件。

具体用法为：修改 nginx.conf 配置文件，需要把 `listen 80` 改为默认的 443 端口 `listen 443 ssl`，或者自己制定端口 `listen 8090 ssl`，并在 `server` 块中增加如下内容：

- 443 默认端口配置：

```conf
server {
  # listen  80;
  # server_name  www.dnhyxc.cn;

  #https配置修改内容开始
  #SSL 默认访问端口号为 443
  listen 443 ssl;
  #请填写绑定证书的域名
  server_name dnhyxc.cn;

  #请填写证书文件的相对路径或绝对路径 cloud.tencent.com_bundle.crt;
  ssl_certificate /usr/local/nginx/certs/dnhyxc.cn_nginx/dnhyxc.cn_bundle.crt;
  #请填写私钥文件的相对路径或绝对路径
  ssl_certificate_key /usr/local/nginx/certs/dnhyxc.cn_nginx/dnhyxc.cn.key;
  #https配置修改内容结束

  location / {
    root  /usr/local/nginx/html/dist;
    index   index.html  index.htm;
    try_files   $uri  $uri/ /index.html;
  }

  location /api/ {
    proxy_set_header  Host  $http_host;
    proxy_set_header  X-Real-IP $remote_addr;
    proxy_set_header  REMOTE-HOST $remote_addr;
    proxy_set_header  X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass  http://localhost:9112;
  }

  location /image/ {
    root  /usr/local/server/src/upload/image;
    rewrite  ^/usr/local/server/src/upload/(.*) /$1 break;
    proxy_pass  http://localhost:9112;
  }

  location /files/ {
    root  /usr/local/server/src/upload/files;
    rewrite  ^/usr/local/server/src/upload/(.*) /$1 break;
    proxy_pass  http://localhost:9112;
  }

  error_page  500 502 503 504 /50x.html;

  location = /50x.html {
    root  html;
  }
}
```

- 自定义端口配置：

```conf
server {
  # listen  8099;
  # server_name  wwww.dnhyxc.cn;

  #https配置修改内容开始
  listen 8090 ssl;
  #请填写绑定证书的域名
  server_name dnhyxc.cn;
  #请填写证书文件的相对路径或绝对路径 cloud.tencent.com_bundle.crt;
  ssl_certificate /usr/local/nginx/certs/dnhyxc.cn_nginx/dnhyxc.cn_bundle.crt;
  #请填写私钥文件的相对路径或绝对路径
  ssl_certificate_key /usr/local/nginx/certs/dnhyxc.cn_nginx/dnhyxc.cn.key;
  #https配置修改内容结束

  location / {
    root  /usr/local/nginx/html_admin/dist;
    index   index.html  index.htm;
    try_files   $uri  $uri/ /index.html;
  }

  location /admin/ {
    proxy_set_header  Host  $http_host;
    proxy_set_header  X-Real-IP $remote_addr;
    proxy_set_header  REMOTE-HOST $remote_addr;
    proxy_set_header  X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_pass  http://localhost:9112;
  }
}
```

### Nginx 不认识 ssl_certificate 问题解决

如果配置 https 后，Nginx 不认识 `ssl_certificate` 这个指令，这 99% 的原因是因为你在编译安装 Nginx 时，没有开启 SSL 模块。默认的 `./configure` 是不包含 HTTPS 支持的。

要解决这个问题，你需要重新编译 Nginx。请按照以下步骤操作（不需要卸载原来的 Nginx，直接覆盖编译即可）：

#### 1. 停止当前运行的 Nginx

```bash
/usr/local/nginx/sbin/nginx -s stop
```

#### 2. 进入 Nginx 源码目录

也就是你之前执行 make 的那个目录，之后重新配置，加上 SSL 模块（执行以下命令（注意结尾的斜杠 \ 不能少））：

```bash
cd /usr/local/nginx/nginx-1.28.3

./configure --prefix=/usr/local/nginx --with-http_ssl_module
```

> 如果你未来还需要配置 HTTP/2，可以顺便加上 --with-http_v2_module
> 如果这一步报错提示缺少 OpenSSL，请先执行：`apt install -y libssl-dev`，然后再执行上面的 `./configure` 命令。

#### 3. 重新编译

```bash
cd /usr/local/nginx/nginx-1.28.3

make
```

注意：这里只需要执行 `make`，千万不要执行 `make install`！否则会覆盖你之前修改好的 nginx.conf 配置文件。

#### 4. 替换旧的 Nginx 启动程序

编译完成后，源码目录的 objs 文件夹下会生成一个新的 nginx 文件。我们需要用它替换掉旧的：

```bash
# 备份旧的启动程序（养成好习惯）
cp /usr/local/nginx/sbin/nginx /usr/local/nginx/sbin/nginx.bak

# 将新编译的程序覆盖过去
cp objs/nginx /usr/local/nginx/sbin/nginx
```

#### 5. 测试配置并启动

```bash
# 测试配置文件是否还有语法错误
/usr/local/nginx/sbin/nginx -t

# 如果提示 test is successful，就可以启动了
/usr/local/nginx/sbin/nginx
```

### 部署前端资源

进入 `/usr/local/nginx/html`，之后将打包好的前端资源包 dist.zip 使用 `rz` 命令上传到 html 文件夹中，接着使用 `unzip dist.zip` 将 dist.zip 解压。

由于 nginx 的配置是资源路径是 `/usr/local/nginx/dnhyxc/dist`，所以需要将 html 文件夹中的原本的 `index.html` 文件删除。

html 文件夹内容如下：

![alt text](http://101.43.50.15/image/59c9b18cea0d13b73e9b608e61c7acd7_66055fcdcfd5e134cd001cef.png)

dist 文件夹下内容如下：

![alt text](http://101.43.50.15/image/99ae2740c46a89319c2657488bc98e22_66055fcdcfd5e134cd001cef.png)

文件解压完成之后，输入如下命令启动 nginx 服务器：

```yaml
cd /usr/local/nginx/sbin

./nginx -t # 检查语法是否有误

./nginx -s reload #启动 nginx
```

执行完上述命令，如果没有报错，那恭喜你，前台项目部署成功了。

### 部署后端资源

`cd /usr/local` 到 local 文件夹中，接着输入 `mkdir server` 创建一个 server 文件夹。

`cd server` 进入到 server 目录下，接着输入命令 `rz` 上传压缩好的后端项目压缩包，我的后端服务是使用 koa 写的，所以这个压缩包中就包含了：`package.json`，`src`，`yarn.lock` 文件。上传完成后，输入 `unzip server.zip` 将项目解压到 server 目录下，解压完成后运行 `yarn 或者 npm install` 安装项目所需安装包。安装完成后，server 文件夹中包含如下文件：

![server](http://101.43.50.15/image/f1258d8bb9bd03a7e70a6bb132c1356c_66055fcdcfd5e134cd001cef.png)

接着运行 `pm2 start ./src/main.js` 启动项目。

具体命令如下，依次执行即可：

```yaml
cd /usr/local

mkdir server

cd server

rz # 选择压缩好的后台服务压缩包

unzip server.zip

yarn install

pm2 start ./src/main.js  #项目入口文件

pm2 list  #查看服务是否稳定运行，可以多执行几遍，防止服务启动后又挂了的情况
```

以上命令执行完成之后，如果没有报错，那恭喜你，后台服务也部署成功了，可以通过购买服务器的公网 ip 访问自己的网站了。

### 解决 pm2 启动项目时 status 一直为 error 的情况

在服务器中依次执行下列命令即可：

```yaml
ps aux | grep pm2

kill -9  pm2项目对应的进程

pm2 update
```

### 重启 nginx

前端资源部署完成之后，需要重启 nginx 使部署的资源生效。进入 `/usr/local/nginx/sbin` 目录下，执行 `./nginx -s reload` 即可重启项目。

### 重启服务

使用 `pm2 list` 查看项目是否在启动状态，如果在启动状态的化，使用 `pm2 delete 项目启动id（id一般是 0）` 关闭原本启动的项目。接着使用 `pm2 ./src/main.js` 重新启动项目。

### pm2 常用命令

`pm2 start ./src/main.js`：启动项目。

`pm2 list`：显示所有进程信息。

`pm2 info 进程 id（如：0）`：显示 id 为 0 的进程详细信息。

`pm2 monit`：进入监视页面，监视每个 node 进程的 CPU 和内存的使用情况。

`pm2 stop/delete 0`：停止/删除 id 为 0 的进程。

`pm2 stop/delete all`：停止/删除所有进程。

`pm2 restart 0`：0 秒停机重载 id 为 11 进程（用于 NETWORKED 进程）。

`pm2 reload 0`：重启 id 为 0 的进程。

`pm2 restart all`：重启所有进程。

`pm2 restart all`：重载所有进程。

`pm2 logs`：显示所有进程的日志。

`pm2 logs 0`：显示进程 id 为 0 的日志。

`pm2 flush`：清空所有日志文件。

`pm2 reloadLogs`：重载所有日志。

`pm2 startup`：产生 init 脚本，保持进程活着。

### 为服务器安装 python3

```yaml
# 安装 python3
$ sudo yum install -y epel-release
$ sudo yum install -y python3

# 升级 pip 为最新版本
$ sudo pip3 install pip -U
```

参考：[https://cloud.tencent.com/developer/article/1835880](https://cloud.tencent.com/developer/article/1835880)

### 为服务器安装 gcc c 语言编译环境

前提条件：想要在你的 CentOS 系统上添加新的软件源，安装软件包，你必须以 root 或者有 sudo 权限的用户身份登录系统。

在 CentOS 上安装 GCC 时，默认的 CentOS 软件源上包含一个名称为 `Development Tools` 的软件包组，这个组合包含了 GCC 编译器以及一系列库文件，还有其他编译软件需要用到的工具。

想要安装 Development Tools 包含 GCC 编译器，运行：

```yaml
sudo yum group install "Development Tools"
```

这个命令安装了一组新的软件包，包括 gcc，g++，和 make。

安装完成之后，使用 `gcc -version` 来验证是否安装成功。

在 CentOS 7 软件源上，默认 GCC 可用版本是 4.8.5，如果出现如下提示，说明安装成功：

```
gcc (GCC) 4.8.5 20150623 (Red Hat 4.8.5-36)
Copyright (C) 2015 Free Software Foundation, Inc.
This is free software; see the source for copying conditions.  There is NO
warranty; not even for MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
```
