package com.jefflower.fdserver.workflow.config;

import org.flowable.common.engine.impl.history.HistoryLevel;
import org.flowable.spring.SpringProcessEngineConfiguration;
import org.flowable.spring.boot.EngineConfigurationConfigurer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FlowableConfig {

    @Bean
    public EngineConfigurationConfigurer<SpringProcessEngineConfiguration> flowableConfigurer() {
        return config -> {
            config.setDatabaseSchemaUpdate("true");
            config.setAsyncExecutorActivate(false);
            config.setHistoryLevel(HistoryLevel.AUDIT);
        };
    }
}
