package com.binder.intellij.lsp

import com.binder.intellij.settings.BinderSettingsConfigurable
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspServer
import com.intellij.platform.lsp.api.LspServerSupportProvider
import com.intellij.platform.lsp.api.lsWidget.LspServerWidgetItem
import javax.swing.Icon

class BinderLspServerSupportProvider : LspServerSupportProvider {
    
    override fun fileOpened(
        project: Project,
        file: VirtualFile,
        serverStarter: LspServerSupportProvider.LspServerStarter
    ) {
        if (isSupportedFile(project, file)) {
            serverStarter.ensureServerStarted(BinderLspServerDescriptor(project))
        }
    }

    override fun createLspServerWidgetItem(lspServer: LspServer, currentFile: VirtualFile?): LspServerWidgetItem? {
        return LspServerWidgetItem(
            lspServer,
            currentFile,
            BinderIcons.Widget,
            settingsPageClass = BinderSettingsConfigurable::class.java
        )
    }

    private fun isSupportedFile(project: Project, file: VirtualFile): Boolean {
        val extension = file.extension?.lowercase()
        if (extension != "md" && extension != "yaml" && extension != "yml") {
            return false
        }

        val basePath = project.basePath ?: return false
        val binderDir = java.io.File(basePath, ".binder")
        return binderDir.exists() && binderDir.isDirectory
    }
}

private object BinderIcons {
    val Widget: Icon = IconLoader.getIcon("/icons/binder-widget.svg", BinderIcons::class.java)
}
