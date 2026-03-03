package com.jefflower.fdserver.auth.entity;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class SysApplicationTest {

    @Test
    void defaultConstructor_setsDefaults() {
        SysApplication app = new SysApplication();

        assertTrue(app.isEnabled());
        assertFalse(app.isBuiltIn());
        assertNull(app.getId());
        assertNull(app.getCode());
        assertNull(app.getName());
    }

    @Test
    void parameterizedConstructor_setsFields() {
        SysApplication app = new SysApplication("fd-web", "FD Web", "Web 应用", true);

        assertEquals("fd-web", app.getCode());
        assertEquals("FD Web", app.getName());
        assertEquals("Web 应用", app.getDescription());
        assertTrue(app.isBuiltIn());
        assertTrue(app.isEnabled());
    }

    @Test
    void settersAndGetters() {
        SysApplication app = new SysApplication();

        app.setId(1L);
        app.setCode("fd-api");
        app.setName("FD API");
        app.setDescription("API 应用");
        app.setEnabled(false);
        app.setBuiltIn(true);

        assertEquals(1L, app.getId());
        assertEquals("fd-api", app.getCode());
        assertEquals("FD API", app.getName());
        assertEquals("API 应用", app.getDescription());
        assertFalse(app.isEnabled());
        assertTrue(app.isBuiltIn());
    }
}
