package com.binder.intellij.lsp

import com.binder.intellij.settings.BinderSettings
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.ProjectWideLspServerDescriptor
import java.io.File

class BinderLspServerDescriptor(project: Project) : ProjectWideLspServerDescriptor(project, "Binder") {

    override fun isSupportedFile(file: VirtualFile): Boolean {
        // Check if file is in a Binder workspace or docs (requires reading config)
        val extension = file.extension
        return extension == "md" || extension == "yaml" || extension == "yml"
    }

    override fun createCommandLine(): GeneralCommandLine {
        val settings = BinderSettings.instance

        return GeneralCommandLine(settings.binderPath, "lsp")
                .withWorkDirectory(project.basePath)
    }

    private fun isBinderWorkspace(): Boolean {
        val basePath = project.basePath ?: return false
        val binderDir = File(basePath, ".binder")
        return binderDir.exists() && binderDir.isDirectory
    }
}
