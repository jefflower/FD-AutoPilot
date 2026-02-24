package com.jefflower.fdserver.workflow.config;

import org.flowable.common.engine.impl.history.HistoryLevel;
import org.flowable.spring.SpringProcessEngineConfiguration;
import org.flowable.spring.boot.EngineConfigurationConfigurer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;

@Configuration
public class FlowableConfig {

    private static final Logger log = LoggerFactory.getLogger(FlowableConfig.class);

    @Bean
    public EngineConfigurationConfigurer<SpringProcessEngineConfiguration> flowableConfigurer() {
        return config -> {
            config.setDatabaseSchemaUpdate("true");
            config.setAsyncExecutorActivate(false);
            config.setHistoryLevel(HistoryLevel.AUDIT);

            // 显式指定 BPMN 资源路径，覆盖默认的 classpath:processes/
            try {
                Resource[] bpmnResources = new PathMatchingResourcePatternResolver()
                        .getResources("classpath:bpmn/*.bpmn20.xml");
                if (bpmnResources.length > 0) {
                    config.setDeploymentResources(bpmnResources);
                    log.info("[FlowableConfig] Found {} BPMN resources for auto-deployment", bpmnResources.length);
                } else {
                    log.warn("[FlowableConfig] No BPMN resources found in classpath:bpmn/");
                }
            } catch (IOException e) {
                log.warn("[FlowableConfig] Failed to scan BPMN resources: {}", e.getMessage());
            }
        };
    }
}
