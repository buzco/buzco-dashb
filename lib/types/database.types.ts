// Hand-written to match supabase/migrations/*.sql until a live project
// exists to generate against. Regenerate for real once linked:
//   npx supabase gen types typescript --linked > lib/types/database.types.ts

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      suppliers: {
        Row: {
          id: string;
          name: string;
          contact_email: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          contact_email?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          contact_email?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      retailers: {
        Row: {
          id: string;
          name: string;
          contact_email: string | null;
          kind: string | null;
          location: string | null;
          status: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          contact_email?: string | null;
          kind?: string | null;
          location?: string | null;
          status?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          contact_email?: string | null;
          kind?: string | null;
          location?: string | null;
          status?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          name: string;
          description: string | null;
          tags: string[] | null;
          shopify_product_id: string | null;
          status: string;
          image_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          description?: string | null;
          tags?: string[] | null;
          shopify_product_id?: string | null;
          status?: string;
          image_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          description?: string | null;
          tags?: string[] | null;
          shopify_product_id?: string | null;
          status?: string;
          image_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      variants: {
        Row: {
          id: string;
          product_id: string;
          size: string | null;
          color: string | null;
          sku: string;
          barcode: string | null;
          retail_price: number | null;
          production_cost: number | null;
          shopify_variant_id: string | null;
          image_url: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          size?: string | null;
          color?: string | null;
          sku: string;
          barcode?: string | null;
          retail_price?: number | null;
          production_cost?: number | null;
          shopify_variant_id?: string | null;
          image_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          size?: string | null;
          color?: string | null;
          sku?: string;
          barcode?: string | null;
          retail_price?: number | null;
          production_cost?: number | null;
          shopify_variant_id?: string | null;
          image_url?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "variants_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_locations: {
        Row: {
          id: string;
          name: string;
          type: Database["public"]["Enums"]["location_type"];
          retailer_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          type: Database["public"]["Enums"]["location_type"];
          retailer_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          type?: Database["public"]["Enums"]["location_type"];
          retailer_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_locations_retailer_id_fkey";
            columns: ["retailer_id"];
            isOneToOne: false;
            referencedRelation: "retailers";
            referencedColumns: ["id"];
          },
        ];
      };
      inventory_movements: {
        Row: {
          id: string;
          variant_id: string;
          location_id: string;
          quantity_change: number;
          reason: Database["public"]["Enums"]["movement_reason"];
          reference_type: string | null;
          reference_id: string | null;
          occurred_at: string;
          notes: string | null;
        };
        Insert: {
          id?: string;
          variant_id: string;
          location_id: string;
          quantity_change: number;
          reason: Database["public"]["Enums"]["movement_reason"];
          reference_type?: string | null;
          reference_id?: string | null;
          occurred_at?: string;
          notes?: string | null;
        };
        Update: {
          id?: string;
          variant_id?: string;
          location_id?: string;
          quantity_change?: number;
          reason?: Database["public"]["Enums"]["movement_reason"];
          reference_type?: string | null;
          reference_id?: string | null;
          occurred_at?: string;
          notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "inventory_movements_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "variants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "inventory_movements_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "inventory_locations";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_orders: {
        Row: {
          id: string;
          supplier_id: string | null;
          status: Database["public"]["Enums"]["po_status"];
          reference: string | null;
          currency: string | null;
          total_bill: number | null;
          order_date: string | null;
          received_date: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          supplier_id?: string | null;
          status?: Database["public"]["Enums"]["po_status"];
          reference?: string | null;
          currency?: string | null;
          total_bill?: number | null;
          order_date?: string | null;
          received_date?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          supplier_id?: string | null;
          status?: Database["public"]["Enums"]["po_status"];
          reference?: string | null;
          currency?: string | null;
          total_bill?: number | null;
          order_date?: string | null;
          received_date?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey";
            columns: ["supplier_id"];
            isOneToOne: false;
            referencedRelation: "suppliers";
            referencedColumns: ["id"];
          },
        ];
      };
      purchase_order_lines: {
        Row: {
          id: string;
          purchase_order_id: string;
          variant_id: string;
          quantity_ordered: number;
          quantity_received: number;
          unit_cost: number | null;
        };
        Insert: {
          id?: string;
          purchase_order_id: string;
          variant_id: string;
          quantity_ordered: number;
          quantity_received?: number;
          unit_cost?: number | null;
        };
        Update: {
          id?: string;
          purchase_order_id?: string;
          variant_id?: string;
          quantity_ordered?: number;
          quantity_received?: number;
          unit_cost?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "purchase_order_lines_purchase_order_id_fkey";
            columns: ["purchase_order_id"];
            isOneToOne: false;
            referencedRelation: "purchase_orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "purchase_order_lines_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "variants";
            referencedColumns: ["id"];
          },
        ];
      };
      expenses: {
        Row: {
          id: string;
          category: string;
          description: string | null;
          amount: number;
          currency: string | null;
          incurred_at: string;
          recurring_interval: string | null;
          source: Database["public"]["Enums"]["expense_source"];
          source_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          category: string;
          description?: string | null;
          amount: number;
          currency?: string | null;
          incurred_at?: string;
          recurring_interval?: string | null;
          source?: Database["public"]["Enums"]["expense_source"];
          source_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          category?: string;
          description?: string | null;
          amount?: number;
          currency?: string | null;
          incurred_at?: string;
          recurring_interval?: string | null;
          source?: Database["public"]["Enums"]["expense_source"];
          source_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      sales: {
        Row: {
          id: string;
          channel: Database["public"]["Enums"]["sale_channel"];
          // null for raffle ticket sales — money in, but no product
          variant_id: string | null;
          quantity: number;
          gross_amount: number;
          discount_amount: number;
          shipping_amount: number;
          fees_amount: number;
          net_amount: number;
          shopify_order_id: string | null;
          shopify_line_item_id: string | null;
          payment_method: string | null;
          market_event_id: string | null;
          notion_page_id: string | null;
          notion_synced_at: string | null;
          notion_error: string | null;
          customer_ref: string | null;
          sold_at: string;
          notes: string | null;
        };
        Insert: {
          id?: string;
          channel: Database["public"]["Enums"]["sale_channel"];
          variant_id?: string | null;
          quantity?: number;
          gross_amount: number;
          discount_amount?: number;
          shipping_amount?: number;
          fees_amount?: number;
          shopify_order_id?: string | null;
          shopify_line_item_id?: string | null;
          payment_method?: string | null;
          market_event_id?: string | null;
          notion_page_id?: string | null;
          notion_synced_at?: string | null;
          notion_error?: string | null;
          customer_ref?: string | null;
          sold_at?: string;
          notes?: string | null;
        };
        Update: {
          id?: string;
          channel?: Database["public"]["Enums"]["sale_channel"];
          variant_id?: string | null;
          quantity?: number;
          gross_amount?: number;
          discount_amount?: number;
          shipping_amount?: number;
          fees_amount?: number;
          shopify_order_id?: string | null;
          shopify_line_item_id?: string | null;
          payment_method?: string | null;
          market_event_id?: string | null;
          notion_page_id?: string | null;
          notion_synced_at?: string | null;
          notion_error?: string | null;
          customer_ref?: string | null;
          sold_at?: string;
          notes?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "sales_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "variants";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sales_market_event_id_fkey";
            columns: ["market_event_id"];
            isOneToOne: false;
            referencedRelation: "market_events";
            referencedColumns: ["id"];
          },
        ];
      };
      consignments: {
        Row: {
          id: string;
          retailer_id: string;
          status: string;
          sent_date: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          retailer_id: string;
          status?: string;
          sent_date?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          retailer_id?: string;
          status?: string;
          sent_date?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "consignments_retailer_id_fkey";
            columns: ["retailer_id"];
            isOneToOne: false;
            referencedRelation: "retailers";
            referencedColumns: ["id"];
          },
        ];
      };
      consignment_lines: {
        Row: {
          id: string;
          consignment_id: string;
          variant_id: string;
          quantity_sent: number;
          quantity_sold: number;
          quantity_returned: number;
          wholesale_price: number | null;
        };
        Insert: {
          id?: string;
          consignment_id: string;
          variant_id: string;
          quantity_sent: number;
          quantity_sold?: number;
          quantity_returned?: number;
          wholesale_price?: number | null;
        };
        Update: {
          id?: string;
          consignment_id?: string;
          variant_id?: string;
          quantity_sent?: number;
          quantity_sold?: number;
          quantity_returned?: number;
          wholesale_price?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "consignment_lines_consignment_id_fkey";
            columns: ["consignment_id"];
            isOneToOne: false;
            referencedRelation: "consignments";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "consignment_lines_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "variants";
            referencedColumns: ["id"];
          },
        ];
      };
      catalogs: {
        Row: {
          id: string;
          name: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      market_events: {
        Row: {
          id: string;
          name: string;
          venue: string | null;
          starts_at: string;
          ends_at: string | null;
          status: string;
          location_id: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          venue?: string | null;
          starts_at?: string;
          ends_at?: string | null;
          status?: string;
          location_id: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          venue?: string | null;
          starts_at?: string;
          ends_at?: string | null;
          status?: string;
          location_id?: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "market_events_location_id_fkey";
            columns: ["location_id"];
            isOneToOne: false;
            referencedRelation: "inventory_locations";
            referencedColumns: ["id"];
          },
        ];
      };
      market_prices: {
        Row: {
          id: string;
          market_event_id: string;
          product_id: string;
          variant_id: string | null;
          price: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          market_event_id: string;
          product_id: string;
          variant_id?: string | null;
          price: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          market_event_id?: string;
          product_id?: string;
          variant_id?: string | null;
          price?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "market_prices_market_event_id_fkey";
            columns: ["market_event_id"];
            isOneToOne: false;
            referencedRelation: "market_events";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "market_prices_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "market_prices_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "variants";
            referencedColumns: ["id"];
          },
        ];
      };
      market_voided_lines: {
        Row: {
          shopify_line_item_id: string;
          market_event_id: string | null;
          voided_at: string;
        };
        Insert: {
          shopify_line_item_id: string;
          market_event_id?: string | null;
          voided_at?: string;
        };
        Update: {
          shopify_line_item_id?: string;
          market_event_id?: string | null;
          voided_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "market_voided_lines_market_event_id_fkey";
            columns: ["market_event_id"];
            isOneToOne: false;
            referencedRelation: "market_events";
            referencedColumns: ["id"];
          },
        ];
      };
      catalog_items: {
        Row: {
          id: string;
          catalog_id: string;
          variant_id: string;
          wholesale_price: number | null;
        };
        Insert: {
          id?: string;
          catalog_id: string;
          variant_id: string;
          wholesale_price?: number | null;
        };
        Update: {
          id?: string;
          catalog_id?: string;
          variant_id?: string;
          wholesale_price?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "catalog_items_catalog_id_fkey";
            columns: ["catalog_id"];
            isOneToOne: false;
            referencedRelation: "catalogs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "catalog_items_variant_id_fkey";
            columns: ["variant_id"];
            isOneToOne: false;
            referencedRelation: "variants";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      current_stock: {
        Row: {
          variant_id: string;
          location_id: string;
          quantity: number;
        };
        Relationships: [];
      };
      current_stock_by_variant: {
        Row: {
          variant_id: string;
          total_quantity: number;
        };
        Relationships: [];
      };
    };
    Functions: {
      receive_po_line: {
        Args: {
          p_line_id: string;
          p_quantity: number;
          p_location_id: string;
        };
        Returns: Database["public"]["Tables"]["purchase_order_lines"]["Row"];
      };
      log_sale: {
        Args: {
          p_channel: Database["public"]["Enums"]["sale_channel"];
          p_variant_id: string;
          p_quantity: number;
          p_location_id: string;
          p_gross_amount: number;
          p_discount_amount?: number;
          p_shipping_amount?: number;
          p_fees_amount?: number;
          p_customer_ref?: string | null;
          p_notes?: string | null;
        };
        Returns: Database["public"]["Tables"]["sales"]["Row"];
      };
      consignment_send: {
        Args: {
          p_consignment_id: string;
          p_variant_id: string;
          p_quantity: number;
          p_wholesale_price: number;
          p_from_location_id: string;
        };
        Returns: Database["public"]["Tables"]["consignment_lines"]["Row"];
      };
      consignment_mark_sold: {
        Args: {
          p_line_id: string;
          p_quantity: number;
        };
        Returns: Database["public"]["Tables"]["consignment_lines"]["Row"];
      };
      consignment_return: {
        Args: {
          p_line_id: string;
          p_quantity: number;
          p_to_location_id: string;
        };
        Returns: Database["public"]["Tables"]["consignment_lines"]["Row"];
      };
      create_market_event: {
        Args: {
          p_name: string;
          p_venue?: string | null;
          p_starts_at?: string;
          p_ends_at?: string | null;
          p_notes?: string | null;
        };
        Returns: Database["public"]["Tables"]["market_events"]["Row"];
      };
      market_load_in: {
        Args: {
          p_market_event_id: string;
          p_variant_id: string;
          p_quantity: number;
          p_from_location_id: string;
        };
        Returns: undefined;
      };
      market_load_out: {
        Args: {
          p_market_event_id: string;
          p_variant_id: string;
          p_quantity: number;
          p_to_location_id: string;
        };
        Returns: undefined;
      };
      log_market_sale: {
        Args: {
          p_market_event_id: string;
          p_variant_id: string;
          p_quantity: number;
          p_gross_amount: number;
          p_discount_amount?: number;
          p_fees_amount?: number;
          p_customer_ref?: string | null;
          p_notes?: string | null;
          p_payment_method?: string | null;
          p_shopify_order_id?: string | null;
          p_shopify_line_item_id?: string | null;
          p_sold_at?: string;
        };
        Returns: Database["public"]["Tables"]["sales"]["Row"];
      };
      set_market_price: {
        Args: {
          p_market_event_id: string;
          p_product_id: string;
          p_variant_id?: string | null;
          p_price?: number | null;
        };
        Returns: undefined;
      };
      bulk_discount_market: {
        Args: { p_market_event_id: string; p_percent: number };
        Returns: number;
      };
      void_market_sale: {
        Args: { p_sale_id: string };
        Returns: undefined;
      };
    };
    Enums: {
      location_type: "warehouse" | "shopify" | "market" | "consignment" | "friends_family";
      po_status: "draft" | "ordered" | "partially_received" | "received" | "cancelled";
      movement_reason:
        | "po_receipt"
        | "sale_shopify"
        | "sale_offline"
        | "consignment_out"
        | "consignment_sold"
        | "consignment_return"
        | "adjustment"
        | "transfer";
      sale_channel: "shopify" | "market" | "friends_family" | "wholesale" | "other";
      expense_source: "purchase_order" | "subscription" | "shipping" | "ads" | "manual" | "other";
    };
    CompositeTypes: Record<string, never>;
  };
}
