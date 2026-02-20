# ============================================================
# FD-Server Multi-stage Dockerfile
# ============================================================
# Build context: project root (FD-AutoPilot/)
# docker-compose.yml sets: context: . , dockerfile: fd-server/Dockerfile
#
# Stage 1: Maven build (with frontend via -Pwith-frontend)
# Stage 2: JRE runtime
# ============================================================

# --- Stage 1: Build ---
FROM maven:3.9-eclipse-temurin-21 AS builder

WORKDIR /build

# Install Node.js for frontend build (required by exec-maven-plugin in -Pwith-frontend)
RUN apt-get update && apt-get install -y curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Copy fd-web source (needed for -Pwith-frontend profile)
COPY fd-web/ /build/fd-web/

# Copy Maven project files first for better layer caching
COPY fd-server/pom.xml /build/fd-server/pom.xml
COPY fd-server/fd-server-common/pom.xml /build/fd-server/fd-server-common/pom.xml
COPY fd-server/fd-server-auth/pom.xml /build/fd-server/fd-server-auth/pom.xml
COPY fd-server/fd-server-task/pom.xml /build/fd-server/fd-server-task/pom.xml
COPY fd-server/fd-server-ticket/pom.xml /build/fd-server/fd-server-ticket/pom.xml
COPY fd-server/fd-server-app/pom.xml /build/fd-server/fd-server-app/pom.xml

# Download dependencies (cached if POMs don't change)
WORKDIR /build/fd-server
RUN mvn dependency:go-offline -B -Dsilent=true || true

# Copy all server source code
COPY fd-server/ /build/fd-server/

# Build with frontend profile, skip tests for faster image build
# Override temurin paths since container uses default java/javac
RUN mvn clean package -Pwith-frontend -DskipTests -B \
    -Dtemurin.jvm=java \
    -Dtemurin.javac=javac

# --- Stage 2: Runtime ---
FROM eclipse-temurin:21-jre

LABEL maintainer="FD-AutoPilot Team"
LABEL description="FD-Server - Intelligent Ticket Processing System"

WORKDIR /app

# Install curl for health check
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# Create non-root user for security
RUN groupadd -r fdserver && useradd -r -g fdserver -d /app fdserver

# Create data and logs directories
RUN mkdir -p /app/data /app/logs && chown -R fdserver:fdserver /app

# Copy the built jar from builder stage
COPY --from=builder /build/fd-server/fd-server-app/target/fd-server-app-*.jar /app/fd-server.jar
RUN chown fdserver:fdserver /app/fd-server.jar

# Switch to non-root user
USER fdserver

# Expose server port
EXPOSE 9988

# JVM configuration
ENV JAVA_OPTS="-Xmx512m -Xms256m -XX:+UseG1GC -XX:+UseContainerSupport -XX:MaxRAMPercentage=75.0"

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD curl -f http://localhost:9988/actuator/health || exit 1

# Entry point
ENTRYPOINT ["sh", "-c", "java $JAVA_OPTS -jar /app/fd-server.jar"]
