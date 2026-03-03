pipeline {
    agent any

    tools {
        maven 'maven'
    }

    environment {
        DEPLOY_DIR = '/var/lib/jenkins/fd-autopilot'
        ENV_FILE   = '/var/lib/jenkins/fd-autopilot/.env'
        PATH       = "/var/lib/jenkins/node-v20.11.1-linux-x64/bin:${env.PATH}"
    }

    triggers {
        // Gitea Webhook 触发后，Jenkins 检测到 SCM 变更即构建
        pollSCM('')
    }

    stages {
        stage('Checkout') {
            steps {
                echo "Pulling latest code from main..."
                checkout scm
            }
        }

        stage('Build') {
            steps {
                echo "Building fd-server with frontend..."
                sh 'mvn -f fd-server/pom.xml clean package -Pwith-frontend -DskipTests'
            }
        }

        stage('Deploy') {
            steps {
                sh '''
                    echo "========== CHECK .env =========="
                    if [ ! -f "${ENV_FILE}" ]; then
                        echo "ERROR: ${ENV_FILE} not found!"
                        echo "Please create it from .env.production.example"
                        exit 1
                    fi

                    echo "========== PREPARE DEPLOY DIR =========="
                    mkdir -p ${DEPLOY_DIR}/logs
                    mkdir -p ${DEPLOY_DIR}/n8n
                    mkdir -p ${DEPLOY_DIR}/data/knowledge

                    echo "========== COPY ARTIFACTS =========="
                    JAR_FILE=$(ls fd-server/fd-server-app/target/fd-server-app-*.jar 2>/dev/null | head -1)
                    if [ -z "$JAR_FILE" ]; then
                        echo "Error: JAR file not found!"
                        ls -la fd-server/fd-server-app/target/ || echo "target dir not found"
                        exit 1
                    fi
                    echo "Found JAR: $JAR_FILE"
                    cp "$JAR_FILE" ${DEPLOY_DIR}/fd-server.jar

                    # 复制启动脚本
                    cp deploy/start.sh ${DEPLOY_DIR}/deploy/start.sh 2>/dev/null || true
                    chmod +x ${DEPLOY_DIR}/deploy/start.sh 2>/dev/null || true

                    # 复制 n8n 配置（如果部署目录没有则复制）
                    if [ ! -f ${DEPLOY_DIR}/n8n/.env ]; then
                        cp deploy/n8n.env ${DEPLOY_DIR}/n8n/.env 2>/dev/null || true
                        echo "Copied n8n.env to deploy dir"
                    else
                        echo "n8n/.env already exists in deploy dir, skipping"
                    fi

                    echo "========== LOAD ENV =========="
                    set -a
                    . "${ENV_FILE}"
                    set +a

                    echo "========== STOP OLD PROCESS =========="
                    pkill -f "n8n start" || true
                    sleep 1

                    PID=$(pgrep -f "java -jar.*fd-server" || true)
                    if [ ! -z "$PID" ]; then
                        echo "Stopping fd-server (PID: $PID)..."
                        kill $PID
                        sleep 5
                        if kill -0 $PID 2>/dev/null; then
                            echo "Force killing..."
                            kill -9 $PID
                            sleep 2
                        fi
                    fi

                    echo "========== START SERVICE =========="
                    cd ${DEPLOY_DIR}

                    JENKINS_NODE_COOKIE=dontKillMe nohup java \
                        ${JAVA_OPTS:--Xmx1g -Xms512m -XX:+UseG1GC} \
                        -Dspring.profiles.active=${SPRING_PROFILES_ACTIVE:-prod} \
                        -Dn8n.enabled=${N8N_ENABLED:-true} \
                        -Dn8n.env-file=${DEPLOY_DIR}/n8n/.env \
                        -Dn8n.external-url=${N8N_EXTERNAL_URL:-http://localhost:5678} \
                        -Dn8n.api-url=${N8N_API_URL:-http://localhost:5678} \
                        -jar fd-server.jar \
                        > logs/fd-server.log 2>&1 &

                    echo "Waiting for service to start..."
                    sleep 20

                    echo "========== VERIFY RESULT =========="
                    NEW_PID=$(pgrep -f "java -jar.*fd-server" || true)
                    if [ ! -z "$NEW_PID" ]; then
                        echo "fd-server started successfully! PID: $NEW_PID"
                        # 健康检查（重试3次）
                        for i in 1 2 3; do
                            if curl -sf http://localhost:9988/actuator/health > /dev/null 2>&1; then
                                echo "Health check: OK"
                                break
                            fi
                            echo "Health check attempt $i failed, retrying in 10s..."
                            sleep 10
                        done
                        if ! curl -sf http://localhost:9988/actuator/health > /dev/null 2>&1; then
                            echo "WARNING: Health check not passing yet, service may still be starting"
                            tail -30 logs/fd-server.log
                        fi
                    else
                        echo "ERROR: fd-server failed to start!"
                        tail -50 logs/fd-server.log
                        exit 1
                    fi
                '''
            }
        }
    }

    post {
        failure {
            echo 'Build or deploy failed!'
        }
        success {
            echo 'Deploy completed successfully!'
        }
    }
}
