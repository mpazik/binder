package com.binder.intellij.lsp

import com.binder.intellij.settings.BinderSettingsConfigurable
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspServer
import com.intellij.platform.lsp.api.LspServerSupportProvider
import com.intellij.platform.lsp.api.lsWidget.LspServerWidgetItem
import java.io.File
import javax.swing.Icon

class BinderLspServerSupportProvider : LspServerSupportProvider {

    private val scanSkipDirs = setOf("node_modules", "dist", "build", "out", "target", ".git")

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
        return hasBinderWorkspace(basePath)
    }

    private fun hasBinderWorkspace(folderPath: String): Boolean {
        if (hasBinderDir(folderPath)) return true

        return try {
            File(folderPath)
                .listFiles()
                ?.any { entry ->
                    entry.isDirectory && !shouldSkipDir(entry.name) && hasBinderDir(entry.absolutePath)
                } == true
        } catch (_: Exception) {
            false
        }
    }

    private fun hasBinderDir(dirPath: String): Boolean {
        val binderDir = File(dirPath, ".binder")
        return binderDir.exists() && binderDir.isDirectory
    }

    private fun shouldSkipDir(name: String): Boolean =
        name.startsWith(".") || scanSkipDirs.contains(name)
}

private object BinderIcons {
    val Widget: Icon = IconLoader.getIcon("/icons/binder-widget.svg", BinderIcons::class.java)
}
