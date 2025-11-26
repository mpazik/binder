package com.binder.intellij.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.util.xmlb.XmlSerializerUtil

@State(
    name = "com.binder.intellij.settings.BinderSettings",
    storages = [Storage("BinderSettings.xml")]
)
class BinderSettings : PersistentStateComponent<BinderSettings> {
    var binderPath: String = "binder"

    override fun getState(): BinderSettings = this

    override fun loadState(state: BinderSettings) {
        XmlSerializerUtil.copyBean(state, this)
    }

    companion object {
        val instance: BinderSettings
            get() = ApplicationManager.getApplication().getService(BinderSettings::class.java)
    }
}
