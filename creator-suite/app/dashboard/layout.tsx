"use client"

import React from "react"
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar"
import { AppSidebar } from "@/components/dashboard/AppSidebar"
import { SiteHeader } from "@/components/dashboard/SiteHeader"
import { HeaderTitleProvider } from "@/components/contexts/header-title-context"
import { DashboardDataProvider } from "@/components/contexts/dashboard-data-context"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <HeaderTitleProvider>
      <DashboardDataProvider>
        <SidebarProvider
          style={{
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties}
        >
          <AppSidebar variant="inset" />
          <SidebarInset>
            <SiteHeader />
            {children}
          </SidebarInset>
        </SidebarProvider>
      </DashboardDataProvider>
    </HeaderTitleProvider>
  )
}
