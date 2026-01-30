package com.jefflower.fdserver;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class FdServerApplication {

	public static void main(String[] args) {
		SpringApplication.run(FdServerApplication.class, args);
	}

}
