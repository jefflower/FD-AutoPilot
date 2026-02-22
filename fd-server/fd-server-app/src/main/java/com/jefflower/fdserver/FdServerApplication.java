package com.jefflower.fdserver;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.liquibase.LiquibaseAutoConfiguration;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication(exclude = {
	LiquibaseAutoConfiguration.class,
})
@EnableScheduling
public class FdServerApplication {

	public static void main(String[] args) {
		SpringApplication.run(FdServerApplication.class, args);
	}

}
