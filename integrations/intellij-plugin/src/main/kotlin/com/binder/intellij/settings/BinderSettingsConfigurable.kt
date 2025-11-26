package com.binder.intellij.settings

import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.openapi.options.Configurable
import com.intellij.openapi.ui.Messages
import com.intellij.ui.components.JBCheckBox
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import java.awt.BorderLayout
import java.io.BufferedReader
import java.io.InputStreamReader
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JPanel

class BinderSettingsConfigurable : Configurable {
    private var binderPathField: JBTextField? = null
    private val settings = BinderSettings.instance

    override fun getDisplayName(): String = "Binder"

    override fun createComponent(): JComponent {
        binderPathField = JBTextField(settings.binderPath)

        val testButton = JButton("Test Connection")
        testButton.addActionListener {
            testBinderConnection()
        }

        return FormBuilder.createFormBuilder()
            .addLabeledComponent("Binder executable path:", binderPathField!!)
            .addComponent(testButton)
            .addComponentFillVertically(JPanel(), 0)
            .panel
    }

    private fun testBinderConnection() {
        val path = binderPathField?.text ?: "binder"
        try {
            val commandLine = GeneralCommandLine(path, "--version")
            val process = commandLine.createProcess()

            val reader = BufferedReader(InputStreamReader(process.inputStream))
            val output = reader.readText()
            val exitCode = process.waitFor()

            if (exitCode == 0) {
                Messages.showInfoMessage(
                    "Binder found!\n\n$output",
                    "Connection Test"
                )
            } else {
                Messages.showErrorDialog(
                    "Binder returned error code $exitCode:\n\n$output",
                    "Connection Test Failed"
                )
            }
        } catch (e: Exception) {
            Messages.showErrorDialog(
                "Failed to execute Binder:\n\n${e.message}\n\nMake sure Binder is installed and the path is correct.",
                "Connection Test Failed"
            )
        }
    }

    override fun isModified(): Boolean {
        return binderPathField?.text != settings.binderPath
    }

    override fun apply() {
        binderPathField?.text?.let { settings.binderPath = it }
    }

    override fun reset() {
        binderPathField?.text = settings.binderPath
    }
}
